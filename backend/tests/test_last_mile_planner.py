"""Backend API tests for Last Mile Planner."""
import os
import io
import pytest
import requests
import openpyxl

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://hub-dispatch-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

PLAN_DATE = "2026-06-23"
TARGET_DELIVERY = "2026-06-25"
RETURN_REQ_DATE = "2026-06-21"


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
        assert d["serviceable_count"] > 0
        assert d["libraries_count"] > 0
        assert "synced_at" in d
        assert "sheet_url" in d


# ----------------------------- plan endpoint -----------------------------
class TestPlanEndpoint:
    def test_plan_with_data(self):
        r = requests.get(f"{API}/plan", params={"date": PLAN_DATE}, timeout=60)
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
        for h in hubs:
            assert "hub_name" in h
            assert "hub_code" in h
            assert "order_count" in h
            assert "return_count" in h
            assert "orders" in h
            assert "returns" in h
            for o in h["orders"]:
                assert o["delivery_date"] == TARGET_DELIVERY, f"Order {o.get('order_id')} delivery_date={o.get('delivery_date')}"
            for ret in h["returns"]:
                assert ret["request_date"] == RETURN_REQ_DATE
                assert ret["return_status"] == "RETURN_REQUESTED"

    def test_plan_empty_date(self):
        r = requests.get(f"{API}/plan", params={"date": "2030-01-01"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["plan_date"] == "2030-01-01"
        assert d["target_delivery_date"] == "2030-01-03"
        assert d["return_request_date"] == "2029-12-30"
        assert d["totals"]["hubs"] == 0
        assert d["totals"]["orders"] == 0
        assert d["totals"]["returns"] == 0
        assert d["hubs"] == []

    def test_plan_invalid_date(self):
        r = requests.get(f"{API}/plan", params={"date": "not-a-date"}, timeout=30)
        assert r.status_code == 400


# ----------------------------- export endpoints -----------------------------
class TestExport:
    def test_export_all(self):
        r = requests.get(f"{API}/plan/export", params={"date": PLAN_DATE}, timeout=60)
        assert r.status_code == 200
        assert "spreadsheetml" in r.headers.get("content-type", "")
        assert "attachment" in r.headers.get("content-disposition", "")
        wb = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True)
        names = [s.lower() for s in wb.sheetnames]
        assert "summary" in names
        assert len(wb.sheetnames) >= 2  # summary + at least one hub

    def test_export_single_hub(self):
        plan = requests.get(f"{API}/plan", params={"date": PLAN_DATE}, timeout=60).json()
        hub_name = plan["hubs"][0]["hub_name"]
        r = requests.get(
            f"{API}/plan/export/hub",
            params={"hub": hub_name, "date": PLAN_DATE},
            timeout=60,
        )
        assert r.status_code == 200, f"Got {r.status_code}: {r.text[:200]}"
        assert "spreadsheetml" in r.headers.get("content-type", "")
        wb = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True)
        assert len(wb.sheetnames) == 1

    def test_export_hub_not_found(self):
        r = requests.get(
            f"{API}/plan/export/hub",
            params={"hub": "NoSuchHub123", "date": PLAN_DATE},
            timeout=30,
        )
        assert r.status_code == 404
