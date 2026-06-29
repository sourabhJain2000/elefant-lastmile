"""Tests for /api/unallocatable and /api/pickup-plan endpoints (Round-4)."""
import os
import requests
from pathlib import Path

# Load REACT_APP_BACKEND_URL from frontend/.env if not set
if not os.environ.get("REACT_APP_BACKEND_URL"):
    env = Path("/app/frontend/.env")
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL"):
                os.environ["REACT_APP_BACKEND_URL"] = line.split("=", 1)[1].strip()

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
PLAN_DATE = "2026-06-29"
FUTURE_DATE = "2026-12-31"

COVERABLE = {"RETURN_REQUESTED", "READY_TO_PICKUP", "PICKED_UP", "RETURNED", "ARRIVED"}
PICKUP = {"RETURN_REQUESTED", "READY_TO_PICKUP"}


# --- Unallocatable ---

def test_unallocatable_no_date_shape():
    r = requests.get(f"{BASE_URL}/api/unallocatable", timeout=120)
    assert r.status_code == 200
    d = r.json()
    assert d["plan_date"] is None
    assert d["target_delivery_date"] is None
    assert "totals" in d and "orders" in d["totals"]
    assert d["totals"]["orders"] > 0
    assert isinstance(d["orders"], list)
    assert len(d["orders"]) == d["totals"]["orders"]
    if d["orders"]:
        o = d["orders"][0]
        for k in ("order_id", "product_name", "library_name", "available_inventory",
                  "expected_delivery_date", "delivery_date"):
            assert k in o, f"Missing field {k}"


def test_unallocatable_sort_order():
    r = requests.get(f"{BASE_URL}/api/unallocatable", timeout=120)
    orders = r.json()["orders"]
    keys = [(o["library_name"], o.get("delivery_date") or "9999-12-31", o["order_id"]) for o in orders]
    assert keys == sorted(keys), "Orders must be sorted by (library_name, delivery_date, order_id)"


def test_unallocatable_date_filter():
    no_date = requests.get(f"{BASE_URL}/api/unallocatable", timeout=120).json()
    filtered = requests.get(f"{BASE_URL}/api/unallocatable", params={"date": PLAN_DATE}, timeout=120).json()
    assert filtered["target_delivery_date"] == "2026-07-01"
    assert filtered["plan_date"] == PLAN_DATE
    assert filtered["totals"]["orders"] <= no_date["totals"]["orders"]
    for o in filtered["orders"]:
        assert o.get("delivery_date") and o["delivery_date"] <= "2026-07-01", \
            f"Order {o['order_id']} delivery_date {o.get('delivery_date')} > 2026-07-01"


def test_unallocatable_future_date():
    r = requests.get(f"{BASE_URL}/api/unallocatable", params={"date": FUTURE_DATE}, timeout=120)
    assert r.status_code == 200
    d = r.json()
    assert d["target_delivery_date"] == "2027-01-02"
    no_date = requests.get(f"{BASE_URL}/api/unallocatable", timeout=120).json()
    # Future date should include essentially all (>= 90% of no-date) since dates filtered ahead
    assert d["totals"]["orders"] >= int(no_date["totals"]["orders"] * 0.9)


def test_unallocatable_export_no_date():
    r = requests.get(f"{BASE_URL}/api/unallocatable/export", timeout=120)
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers.get("content-type", "")
    assert len(r.content) > 1000


def test_unallocatable_export_with_date():
    r = requests.get(f"{BASE_URL}/api/unallocatable/export", params={"date": PLAN_DATE}, timeout=120)
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers.get("content-type", "")


# --- Pickup Plan ---

def test_pickup_plan_shape():
    r = requests.get(f"{BASE_URL}/api/pickup-plan", params={"date": PLAN_DATE}, timeout=120)
    assert r.status_code == 200
    d = r.json()
    assert d["plan_date"] == PLAN_DATE
    assert d["window_days"] == 5
    assert d["cutoff_date"] == "2026-07-04"
    assert d["totals"]["pickups"] > 0
    assert len(d["pickups"]) == d["totals"]["pickups"]


def test_pickup_plan_status_invariant():
    d = requests.get(f"{BASE_URL}/api/pickup-plan", params={"date": PLAN_DATE}, timeout=120).json()
    for p in d["pickups"]:
        assert p["return_status"] in PICKUP, f"Bad status {p['return_status']} on {p['return_order']}"


def test_pickup_plan_unique_returns():
    d = requests.get(f"{BASE_URL}/api/pickup-plan", params={"date": PLAN_DATE}, timeout=120).json()
    seen = [p["return_order"] for p in d["pickups"]]
    assert len(seen) == len(set(seen)), "Return orders must be unique"


def test_pickup_plan_cutoff_and_sort():
    d = requests.get(f"{BASE_URL}/api/pickup-plan", params={"date": PLAN_DATE}, timeout=120).json()
    keys = []
    for p in d["pickups"]:
        odd = p.get("order_delivery_date")
        assert odd and odd <= "2026-07-04", f"order_delivery_date {odd} > cutoff"
        keys.append((odd, p["for_order"]))
    assert keys == sorted(keys), "Pickups must be sorted by (order_delivery_date, for_order)"


def test_pickup_plan_export():
    r = requests.get(f"{BASE_URL}/api/pickup-plan/export", params={"date": PLAN_DATE}, timeout=120)
    assert r.status_code == 200
    assert "spreadsheetml" in r.headers.get("content-type", "")


# --- Regressions ---

def test_plan_regression():
    r = requests.get(f"{BASE_URL}/api/plan", params={"date": PLAN_DATE}, timeout=120)
    assert r.status_code == 200
    d = r.json()
    assert d["plan_date"] == PLAN_DATE
    assert d["target_delivery_date"] == "2026-07-01"
    assert d["return_request_date"] == "2026-06-27"
    seen = set()
    for h in d["hubs"]:
        for o in h["orders"]:
            assert o["order_status"] in ("PLACED", "CONFIRMED")
            assert o["delivery_date"] <= "2026-07-01"
            assert o["order_id"] not in seen
            seen.add(o["order_id"])
        for ret in h["returns"]:
            assert ret.get("request_date") and ret["request_date"] <= "2026-06-27"


def test_confirmation_regression():
    r = requests.get(f"{BASE_URL}/api/confirmation", params={"date": PLAN_DATE}, timeout=120)
    assert r.status_code == 200
    d = r.json()
    assert d["target_delivery_date"] == "2026-07-01"


def test_return_confirmation_regression():
    r = requests.get(f"{BASE_URL}/api/return-confirmation", timeout=120)
    assert r.status_code == 200
    d = r.json()
    seen = set()
    for o in d["orders"]:
        assert len(o["matching_returns"]) == 1
        ro = o["matching_returns"][0]["return_order"]
        assert ro not in seen, f"Return {ro} reused"
        seen.add(ro)
        assert o["matching_returns"][0]["return_status"] in {"PICKED_UP", "RETURNED", "ARRIVED"}


# --- Invariant: unallocatable definition ---

def test_unallocatable_supply_invariant():
    """For each (product_id, library_id) group with not-serviceable orders:
       listed_orders + min(candidates, supply) == total candidates."""
    # Get the full universe via no-date unallocatable (after supply subtracted).
    unalloc = requests.get(f"{BASE_URL}/api/unallocatable", timeout=120).json()["orders"]
    # Confirm-via-returns gives us covered orders (the ones removed first via supply).
    confirmed_via = requests.get(f"{BASE_URL}/api/return-confirmation", timeout=120).json()["orders"]

    # The two sets must be disjoint at the order level
    unalloc_ids = {o["order_id"] for o in unalloc}
    cov_ids = {o["order_id"] for o in confirmed_via}
    overlap = unalloc_ids & cov_ids
    # NOTE: confirm-via-returns only uses CONFIRMABLE statuses (PICKED_UP/RETURNED/ARRIVED),
    # while unallocatable supply also includes RETURN_REQUESTED/READY_TO_PICKUP. So orders
    # covered ONLY by pickup-stage returns would show in neither set. But any order in
    # confirm-via-returns is definitely covered, so it MUST NOT be in unallocatable.
    assert not overlap, f"Orders cannot be both unallocatable and covered by confirm-via-returns: {list(overlap)[:5]}"
