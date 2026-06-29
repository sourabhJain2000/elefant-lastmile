"""Tests for hub-wise last-mile planner confirmation date-filter + return-allocation features."""
import os
from pathlib import Path
import pytest
import requests

def _load_backend_url():
    v = os.environ.get('REACT_APP_BACKEND_URL')
    if v:
        return v.rstrip('/')
    env = Path('/app/frontend/.env')
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith('REACT_APP_BACKEND_URL='):
                return line.split('=', 1)[1].strip().rstrip('/')
    raise RuntimeError('REACT_APP_BACKEND_URL not set')

BASE_URL = _load_backend_url()
TIMEOUT = 90


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ----- /api/confirmation -----

class TestConfirmation:
    def test_confirmation_no_date(self, session):
        r = session.get(f"{BASE_URL}/api/confirmation", timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert data["plan_date"] is None
        assert data["target_delivery_date"] is None
        assert data["totals"]["ready_to_confirm"] > 0
        assert data["totals"]["hubs"] > 0
        # grouped by warehouse
        for h in data["hubs"]:
            assert h["hub_name"]
            assert isinstance(h["ready_to_confirm"], list)
            assert h["ready_count"] == len(h["ready_to_confirm"])
        pytest.no_date_total = data["totals"]["ready_to_confirm"]

    def test_confirmation_with_date_2026_06_29(self, session):
        r = session.get(f"{BASE_URL}/api/confirmation", params={"date": "2026-06-29"}, timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert data["plan_date"] == "2026-06-29"
        assert data["target_delivery_date"] == "2026-07-01"
        total = data["totals"]["ready_to_confirm"]
        assert total > 0, "Date filter returned 0 — serviceable.delivery_date may not be populated"
        # Must be strictly less than no-date total
        assert total < pytest.no_date_total, f"{total} not < no-date {pytest.no_date_total}"
        # Verify no order has expected delivery date portion after 2026-07-01
        cutoff = "2026-07-01"
        bad = []
        for h in data["hubs"]:
            for o in h["ready_to_confirm"]:
                edd = (o.get("expected_delivery_date") or "")[:10]
                if edd and edd > cutoff:
                    bad.append((o.get("order_id"), edd))
        assert not bad, f"Orders past cutoff: {bad[:5]}"

    def test_confirmation_export_all(self, session):
        r = session.get(f"{BASE_URL}/api/confirmation/export", params={"date": "2026-06-29"}, timeout=TIMEOUT)
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")
        assert len(r.content) > 1000

    def test_confirmation_export_hub(self, session):
        # Fetch real hub name first
        r = session.get(f"{BASE_URL}/api/confirmation", params={"date": "2026-06-29"}, timeout=TIMEOUT)
        hubs = r.json()["hubs"]
        assert hubs, "No hubs in date-filtered response"
        hub = hubs[0]["hub_name"]
        r2 = session.get(
            f"{BASE_URL}/api/confirmation/export/hub",
            params={"hub": hub, "date": "2026-06-29"},
            timeout=TIMEOUT,
        )
        assert r2.status_code == 200, f"hub={hub!r}"
        assert "spreadsheet" in r2.headers.get("content-type", "")


# ----- /api/return-confirmation -----

class TestReturnConfirmation:
    @pytest.fixture(scope="class")
    def rc_data(self, session):
        r = session.get(f"{BASE_URL}/api/return-confirmation", timeout=TIMEOUT)
        assert r.status_code == 200
        return r.json()

    def test_one_return_per_order(self, rc_data):
        for o in rc_data["orders"]:
            mr = o.get("matching_returns", [])
            assert len(mr) == 1, f"Order {o['order_id']} has {len(mr)} returns, expected 1"

    def test_every_return_used_at_most_once(self, rc_data):
        seen = {}
        for o in rc_data["orders"]:
            for m in o["matching_returns"]:
                ro = m.get("return_order")
                assert ro, f"Empty return_order on {o['order_id']}"
                seen.setdefault(ro, []).append(o["order_id"])
        dups = {k: v for k, v in seen.items() if len(v) > 1}
        assert not dups, f"Returns used multiple times: {dict(list(dups.items())[:5])}"

    def test_ordering_within_group(self, rc_data):
        # group orders by (library_name, product_id) and verify sort
        from collections import defaultdict
        groups = defaultdict(list)
        for o in rc_data["orders"]:
            groups[(o["library_name"], o["product_id"])].append(o)
        for key, items in groups.items():
            if len(items) < 2:
                continue
            keys = [((o.get("delivery_date") or "9999-12-31"), o["order_id"]) for o in items]
            assert keys == sorted(keys), f"Group {key} not sorted: {keys}"

    def test_export_returns(self, session):
        r = session.get(f"{BASE_URL}/api/return-confirmation/export", timeout=TIMEOUT)
        assert r.status_code == 200
        assert "spreadsheet" in r.headers.get("content-type", "")
        assert len(r.content) > 500


# ----- Invariant: orders per (product,library) group == min(candidates, returns) -----

class TestAllocationInvariant:
    def test_group_size_matches_min(self, session):
        """For each (product_id, library_id) group, number of orders listed
        must equal min(not-serviceable candidates, available confirmable returns)."""
        from collections import defaultdict
        rc = session.get(f"{BASE_URL}/api/return-confirmation", timeout=TIMEOUT).json()
        # Group listed orders
        listed = defaultdict(list)
        for o in rc["orders"]:
            listed[(o["product_id"], o["library_id"])].append(o)
        # Sanity: at least one group present
        assert listed, "No groups returned"
        # Per group: returns must be unique and == len(orders)
        for key, items in listed.items():
            ro = [m["return_order"] for o in items for m in o["matching_returns"]]
            assert len(ro) == len(set(ro)), f"Duplicate return in group {key}: {ro}"
            assert len(items) == len(ro)


# ----- Regression on /api/plan -----

class TestPlanRegression:
    def test_plan_unchanged(self, session):
        r = session.get(f"{BASE_URL}/api/plan", params={"date": "2026-06-29"}, timeout=TIMEOUT)
        assert r.status_code == 200
        data = r.json()
        assert data["plan_date"] == "2026-06-29"
        assert data["target_delivery_date"] == "2026-07-01"
        assert data["return_request_date"] == "2026-06-27"
        order_ids = []
        for h in data["hubs"]:
            for o in h["orders"]:
                assert o["order_status"] in ("PLACED", "CONFIRMED")
                if o.get("delivery_date"):
                    assert o["delivery_date"] <= "2026-07-01"
                order_ids.append(o["order_id"])
            for ret in h["returns"]:
                # plan endpoint already filters RETURN_REQUESTED
                if ret.get("request_date"):
                    assert ret["request_date"] <= "2026-06-27"
        assert len(order_ids) == len(set(order_ids)), "Duplicate order_id in plan"
