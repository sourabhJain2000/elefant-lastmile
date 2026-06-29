"""Backend API tests for Last Mile Planner + Order Confirmation + Confirm via Returns."""
import os
import io
import pytest
import requests
import openpyxl

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

PLAN_DATE = "2026-06-29"
TARGET_DELIVERY = "2026-07-01"
RETURN_REQ_DATE = "2026-06-27"
TOMORROW = "2026-06-30"


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


# --------------------- plan endpoint (BUG FIX validation) ---------------------
class TestPlanEndpoint:
    @pytest.fixture(scope="class")
    def plan(self):
        r = requests.get(f"{API}/plan", params={"date": PLAN_DATE}, timeout=120)
        assert r.status_code == 200, r.text[:500]
        return r.json()

    def test_plan_shape(self, plan):
        assert plan["plan_date"] == PLAN_DATE
        assert plan["target_delivery_date"] == TARGET_DELIVERY
        assert plan["return_request_date"] == RETURN_REQ_DATE
        t = plan["totals"]
        assert t["hubs"] > 0
        assert t["orders"] > 0
        assert t["returns"] > 0

    def test_bug_fix_orders_total_above_160(self, plan):
        # Previously the buggy query returned ~160. Must be > 160 now.
        assert plan["totals"]["orders"] > 160, (
            f"Orders total {plan['totals']['orders']} is still suspiciously low (bug not fixed?)"
        )

    def test_orders_within_window_and_no_delivered_shipped(self, plan):
        # Invariants: every order has delivery_date <= TARGET_DELIVERY (+2),
        # order_status NOT IN {DELIVERED, SHIPPED}, is_overdue iff < plan_date.
        forbidden = {"DELIVERED", "SHIPPED"}
        total_orders = 0
        overdue_count = 0
        for h in plan["hubs"]:
            for o in h["orders"]:
                total_orders += 1
                dd = o.get("delivery_date")
                assert dd is not None, f"order {o.get('order_id')} has null delivery_date"
                assert dd <= TARGET_DELIVERY, (
                    f"order {o.get('order_id')} delivery_date {dd} exceeds target {TARGET_DELIVERY}"
                )
                status = (o.get("order_status") or "").upper()
                assert status not in forbidden, (
                    f"order {o.get('order_id')} has forbidden status {status}"
                )
                expected_overdue = dd < PLAN_DATE
                assert bool(o.get("is_overdue")) == expected_overdue, (
                    f"order {o.get('order_id')} is_overdue={o.get('is_overdue')} vs dd={dd}"
                )
                if expected_overdue:
                    overdue_count += 1
        assert total_orders == plan["totals"]["orders"]
        assert overdue_count == plan["totals"]["orders_overdue"]

    def test_previously_missing_window_now_included(self, plan):
        # The bug specifically dropped orders with delivery_date in {plan_date, plan_date+1}.
        today_count = 0
        tomorrow_count = 0
        for h in plan["hubs"]:
            for o in h["orders"]:
                dd = o.get("delivery_date")
                if dd == PLAN_DATE:
                    today_count += 1
                elif dd == TOMORROW:
                    tomorrow_count += 1
        assert today_count + tomorrow_count > 0, (
            "Expected orders with delivery_date in {PLAN_DATE, TOMORROW} (the previously-missing window) but found none"
        )

    def test_returns_logic_unchanged(self, plan):
        # Plan only contains RETURN_REQUESTED with request_date <= plan_date-2.
        for h in plan["hubs"]:
            for ret in h["returns"]:
                assert ret["request_date"] is not None
                assert ret["request_date"] <= RETURN_REQ_DATE, (
                    f"return {ret.get('return_order')} request_date {ret['request_date']} exceeds cutoff"
                )

    def test_serviceability_mapping(self, plan):
        seen = 0
        for h in plan["hubs"]:
            for o in h["orders"]:
                if o.get("serveable_status"):
                    s = o["serveable_status"].lower()
                    assert "fully" in s or "not" in s or "partial" in s
                    seen += 1
        assert seen > 0, "No orders carry serveable_status — serviceability mapping looks broken"

    def test_plan_empty_far_past(self):
        r = requests.get(f"{API}/plan", params={"date": "2020-01-01"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["totals"]["orders"] == 0
        assert d["totals"]["returns"] == 0
        assert d["totals"]["hubs"] == 0

    def test_plan_invalid_date(self):
        r = requests.get(f"{API}/plan", params={"date": "not-a-date"}, timeout=30)
        assert r.status_code == 400


# ----------------------------- plan export -----------------------------
class TestPlanExport:
    def test_export_all(self):
        r = requests.get(f"{API}/plan/export", params={"date": PLAN_DATE}, timeout=180)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        wb = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True)
        names = [s.lower() for s in wb.sheetnames]
        assert "summary" in names
        assert len(wb.sheetnames) >= 2  # Summary + at least one hub

    def test_export_hub_not_found(self):
        r = requests.get(
            f"{API}/plan/export/hub",
            params={"hub": "NoSuchHub123", "date": PLAN_DATE},
            timeout=30,
        )
        assert r.status_code == 404


# ----------------------------- order confirmation (regression) -----------------------------
class TestConfirmation:
    @pytest.fixture(scope="class")
    def conf(self):
        r = requests.get(f"{API}/confirmation", timeout=120)
        assert r.status_code == 200
        return r.json()

    def test_structure_and_totals(self, conf):
        assert "totals" in conf and "hubs" in conf
        t = conf["totals"]
        assert t["hubs"] > 0
        assert t["ready_to_confirm"] > 0

    def test_hub_counts(self, conf):
        for h in conf["hubs"]:
            assert h["ready_count"] == len(h["ready_to_confirm"])

    def test_export_all(self):
        r = requests.get(f"{API}/confirmation/export", timeout=120)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")


# --------------------- confirm via returns (regression + ARRIVED) ---------------------
class TestReturnConfirmation:
    @pytest.fixture(scope="class")
    def rc(self):
        r = requests.get(f"{API}/return-confirmation", timeout=120)
        assert r.status_code == 200
        return r.json()

    def test_shape(self, rc):
        assert "totals" in rc and "orders" in rc
        assert rc["totals"]["orders"] == len(rc["orders"])

    def test_every_matching_return_status_in_allowed_set(self, rc):
        allowed = {"PICKED_UP", "RETURNED", "ARRIVED"}
        checked = 0
        for o in rc["orders"]:
            matches = o.get("matching_returns") or []
            assert len(matches) > 0, f"order {o.get('order_id')} has no matching_returns"
            for m in matches:
                st = (m.get("return_status") or "").upper()
                assert st in allowed, (
                    f"return {m.get('return_order')} status {st} not in {allowed}"
                )
                checked += 1
        # Allow zero orders edge case but at least the shape held.
        if rc["orders"]:
            assert checked > 0

    def test_export(self):
        r = requests.get(f"{API}/return-confirmation/export", timeout=120)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
