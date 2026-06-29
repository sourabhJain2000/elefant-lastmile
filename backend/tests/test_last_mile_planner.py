"""Backend API tests for Last Mile Planner + Order Confirmation."""
import os
import io
import pytest
import requests
import openpyxl

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://hub-dispatch-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PLAN_DATE = "2026-06-29"
TARGET_DELIVERY = "2026-07-01"
RETURN_REQ_DATE = "2026-06-27"


# ----------------------------- sync status -----------------------------
class TestSyncStatus:
    def test_sync_status_already_synced(self):
        r = requests.get(f"{API}/sync/status", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("synced") is True
        assert d["orders_count"] > 0
        assert d["returns_count"] > 0
        assert d["serviceable_count"] > 0
        assert d["libraries_count"] > 0


# ----------------------------- sync endpoint -----------------------------
class TestSyncEndpoint:
    def test_post_sync_default_url(self):
        r = requests.post(f"{API}/sync", json={}, timeout=180)
        assert r.status_code == 200, f"Status {r.status_code}: {r.text[:300]}"
        d = r.json()
        assert d["orders_count"] > 0
        assert d["returns_count"] > 0
        # serviceable_count should be in the ~1600s after the new sheet schema
        assert d["serviceable_count"] > 500, f"serviceable_count too low: {d['serviceable_count']}"
        assert d["libraries_count"] > 0
        assert "synced_at" in d
        assert "sheet_url" in d


# ----------------------------- plan endpoint -----------------------------
class TestPlanEndpoint:
    def test_plan_with_data(self):
        r = requests.get(f"{API}/plan", params={"date": PLAN_DATE}, timeout=90)
        assert r.status_code == 200
        d = r.json()
        assert d["plan_date"] == PLAN_DATE
        assert d["target_delivery_date"] == TARGET_DELIVERY
        assert d["return_request_date"] == RETURN_REQ_DATE
        totals = d["totals"]
        assert totals["hubs"] > 0
        assert totals["orders"] > 0
        assert totals["returns"] > 0
        hubs = d["hubs"]
        assert len(hubs) > 0

        # Serviceability mapped onto orders: at least some should have status set
        svc_set = 0
        for h in hubs:
            for o in h["orders"]:
                # scheduled orders deliver exactly +2; overdue orders have past dates
                if not o.get("is_overdue"):
                    assert o["delivery_date"] == TARGET_DELIVERY, f"Order {o.get('order_id')} delivery_date={o.get('delivery_date')}"
                else:
                    assert o["delivery_date"] < PLAN_DATE
                if o.get("serveable_status"):
                    s = o["serveable_status"].lower()
                    assert "fully" in s or "not" in s or "partial" in s
                    svc_set += 1
            for ret in h["returns"]:
                # plan only contains RETURN_REQUESTED rows (enforced by query),
                # request_date must be on or before plan_date-2
                assert ret["request_date"] is not None
                assert ret["request_date"] <= RETURN_REQ_DATE
        assert svc_set > 0, "No orders carry serveable_status — serviceability mapping looks broken"

    def test_plan_empty_date(self):
        # Using a far past date — no orders or returns qualify
        r = requests.get(f"{API}/plan", params={"date": "2020-01-01"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["plan_date"] == "2020-01-01"
        assert d["target_delivery_date"] == "2020-01-03"
        assert d["return_request_date"] == "2019-12-30"
        assert d["totals"]["returns"] == 0
        assert d["totals"]["orders"] == 0
        assert d["totals"]["hubs"] == 0

    def test_plan_invalid_date(self):
        r = requests.get(f"{API}/plan", params={"date": "not-a-date"}, timeout=30)
        assert r.status_code == 400


# ----------------------------- plan export endpoints -----------------------------
class TestPlanExport:
    def test_export_all(self):
        r = requests.get(f"{API}/plan/export", params={"date": PLAN_DATE}, timeout=120)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        wb = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True)
        names = [s.lower() for s in wb.sheetnames]
        assert "summary" in names
        assert len(wb.sheetnames) >= 2

    def test_export_hub_not_found(self):
        r = requests.get(
            f"{API}/plan/export/hub",
            params={"hub": "NoSuchHub123", "date": PLAN_DATE},
            timeout=30,
        )
        assert r.status_code == 404


# ----------------------------- confirmation endpoint -----------------------------
class TestConfirmation:
    @pytest.fixture(scope="class")
    def conf(self):
        r = requests.get(f"{API}/confirmation", timeout=120)
        assert r.status_code == 200
        return r.json()

    def test_confirmation_structure(self, conf):
        assert "totals" in conf and "hubs" in conf
        t = conf["totals"]
        assert t["hubs"] > 0
        assert t["ready_to_confirm"] > 0, "ready_to_confirm totals must be > 0"
        assert t["awaiting_return"] > 0, "awaiting_return totals must be > 0"

    def test_hub_shape_and_counts(self, conf):
        for h in conf["hubs"]:
            assert "hub_name" in h
            assert "hub_code" in h
            assert "ready_count" in h
            assert "awaiting_count" in h
            assert h["ready_count"] == len(h["ready_to_confirm"])
            assert h["awaiting_count"] == len(h["awaiting_return"])

    def test_ready_orders_are_placed(self, conf):
        checked = 0
        for h in conf["hubs"]:
            for o in h["ready_to_confirm"]:
                assert (o.get("order_status") or "").upper() == "PLACED", (
                    f"Non-PLACED order in ready_to_confirm: {o.get('order_id')}={o.get('order_status')}"
                )
                checked += 1
        assert checked > 0

    def test_awaiting_orders_have_pending_returns(self, conf):
        checked = 0
        for h in conf["hubs"]:
            for o in h["awaiting_return"]:
                matches = o.get("matching_returns") or []
                assert len(matches) > 0, f"awaiting_return order {o.get('order_id')} has no matching_returns"
                for m in matches:
                    assert (m.get("return_status") or "").upper() != "RETURN_CONFIRMED", (
                        f"matching return {m.get('return_order')} is already RETURN_CONFIRMED"
                    )
                checked += 1
        assert checked > 0


# ----------------------------- confirmation export -----------------------------
class TestConfirmationExport:
    def test_export_all_confirmation(self):
        r = requests.get(f"{API}/confirmation/export", timeout=120)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        wb = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True)
        names = [s.lower() for s in wb.sheetnames]
        assert "summary" in names
        assert len(wb.sheetnames) >= 2  # Summary + at least one warehouse

    def test_export_hub_confirmation(self):
        conf = requests.get(f"{API}/confirmation", timeout=120).json()
        # pick a hub that actually has content
        hub = next(
            (h for h in conf["hubs"] if h["ready_count"] + h["awaiting_count"] > 0),
            conf["hubs"][0],
        )
        r = requests.get(
            f"{API}/confirmation/export/hub",
            params={"hub": hub["hub_name"]},
            timeout=60,
        )
        assert r.status_code == 200, f"Got {r.status_code}: {r.text[:200]}"
        assert "spreadsheetml" in r.headers.get("content-type", "")
        wb = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True)
        assert len(wb.sheetnames) == 1

    def test_export_hub_confirmation_not_found(self):
        r = requests.get(
            f"{API}/confirmation/export/hub",
            params={"hub": "NoSuchHub_X1Y2"},
            timeout=30,
        )
        assert r.status_code == 404
