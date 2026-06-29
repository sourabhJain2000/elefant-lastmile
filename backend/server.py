from fastapi import FastAPI, APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import re
import logging
import urllib.request
from pathlib import Path
from pydantic import BaseModel
from datetime import datetime, timezone, date, timedelta
import openpyxl

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1Q7eGyhFSp-GuhqSMFGMvsE-XOQp8o5Hrm1Cwl4vw1YM/edit?gid=1958626721#gid=1958626721"

DELIVERED_STATUSES = {"DELIVERED"}
RETURN_REQUESTED_STATUS = "RETURN_REQUESTED"


# ----------------------------- helpers -----------------------------

def extract_sheet_id(url: str) -> str:
    m = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]+)", url or "")
    if not m:
        raise HTTPException(status_code=400, detail="Invalid Google Sheet URL")
    return m.group(1)


def fetch_workbook(sheet_id: str):
    url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=xlsx"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        data = urllib.request.urlopen(req, timeout=120).read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch the Google Sheet. Make sure it is shared as 'Anyone with the link'. ({e})")
    return openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)


def find_sheet(wb, *keywords):
    for ws in wb.worksheets:
        title = ws.title.lower()
        if all(k.lower() in title for k in keywords):
            return ws
    return None


def sheet_records(ws):
    if ws is None:
        return []
    rows = ws.iter_rows(values_only=True)
    try:
        header = next(rows)
    except StopIteration:
        return []
    header = [str(h).strip() if h is not None else "" for h in header]
    out = []
    for r in rows:
        if r is None:
            continue
        rec = {}
        empty = True
        for h, v in zip(header, r):
            if not h or h in rec:
                continue
            if v is not None and str(v).strip() != "":
                empty = False
            rec[h] = v
        if not empty:
            out.append(rec)
    return out


def to_date_str(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    if not s:
        return None
    s = s.replace("Z", "")
    try:
        return datetime.fromisoformat(s.split(".")[0]).date().isoformat()
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:19], fmt).date().isoformat()
        except Exception:
            continue
    return None


def clean(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


# ----------------------------- models -----------------------------

class SyncRequest(BaseModel):
    sheet_url: str | None = None


# ----------------------------- sync -----------------------------

@api_router.post("/sync")
async def sync_sheet(body: SyncRequest):
    sheet_url = (body.sheet_url or DEFAULT_SHEET_URL).strip()
    sheet_id = extract_sheet_id(sheet_url)
    wb = fetch_workbook(sheet_id)

    orders_ws = find_sheet(wb, "order") or wb.worksheets[0]
    returns_ws = find_sheet(wb, "return")
    serviceable_ws = find_sheet(wb, "serviceable") or find_sheet(wb, "servic")
    library_ws = find_sheet(wb, "librar")

    order_docs = []
    for r in sheet_records(orders_ws):
        status = clean(r.get("Order Status")).upper()
        if status in DELIVERED_STATUSES:
            continue
        order_docs.append({
            "order_id": clean(r.get("Order Id")),
            "product_id": clean(r.get("Product Id")),
            "toy_name": clean(r.get("Toy Name")),
            "library_id": clean(r.get("Library Id")),
            "library_name": clean(r.get("Library Name")) or "Unassigned",
            "user_id": clean(r.get("User Id")),
            "user_name": clean(r.get("User Name")),
            "pincode": clean(r.get("Pincode")),
            "plan_type": clean(r.get("Plan Type")),
            "order_status": status,
            "expected_delivery_date": clean(r.get("Expected Delivery Date")),
            "delivery_date": to_date_str(r.get("Expected Delivery Date")),
            "delivery_type": clean(r.get("Delivery Type")),
            "delivery_partner": clean(r.get("Delivery Partner")),
            "toy_type": clean(r.get("Toy Type")),
            "is_pre_order": clean(r.get("Is Pre ORder")),
            "is_force_order": clean(r.get("Is Force Order")),
            "tags": clean(r.get("Tags")),
        })

    # Returns: store all that are NOT yet RETURN_CONFIRMED (pipeline returns).
    # The last-mile planner uses the RETURN_REQUESTED subset; the order
    # confirmation view uses any pending return as potential incoming stock.
    return_docs = []
    for r in sheet_records(returns_ws):
        status = clean(r.get("Return Order Status")).upper()
        if not status or status == "RETURN_CONFIRMED":
            continue
        receiving = clean(r.get("Receiving Library Name"))
        owner = clean(r.get("Owner Library Name"))
        hub = receiving or owner or "Unassigned"
        return_docs.append({
            "return_order": clean(r.get("Return Order")),
            "order_id": clean(r.get("Order Id")),
            "product_id": clean(r.get("Product Id")),
            "product_name": clean(r.get("Product Name")),
            "owner_library": clean(r.get("Owner Library")),
            "owner_library_name": owner,
            "receiving_library": clean(r.get("Receiving Library")),
            "receiving_library_name": receiving,
            "hub_name": hub,
            "user_id": clean(r.get("User Id")),
            "user_name": clean(r.get("User Name")),
            "pincode": clean(r.get("Pincode")),
            "plan_type": clean(r.get("Plan Type")),
            "return_status": status,
            "toy_condition": clean(r.get("Toy Condition")),
            "return_created_at": clean(r.get("Return Created At")),
            "request_date": to_date_str(r.get("Return Created At")),
            "is_pre_order": clean(r.get("Is Pre Order")),
            "is_force_order": clean(r.get("Is Force Order")),
            "tags": clean(r.get("Tags")),
        })

    # Serviceability snapshot (one row per PLACED order).
    serviceable_docs = []
    seen_orders = set()
    for r in sheet_records(serviceable_ws):
        oid = clean(r.get("Order Number")) or clean(r.get("order_id"))
        if not oid or oid in seen_orders:
            continue
        seen_orders.add(oid)
        svc_raw = clean(r.get("Serviceability")) or clean(r.get("Serveable Status"))
        inv = r.get("Available Inventory")
        try:
            inv_num = int(float(inv)) if inv not in (None, "") else 0
        except Exception:
            inv_num = 0
        serviceable_docs.append({
            "order_id": oid,
            "serviceability": svc_raw,
            "order_status": clean(r.get("Order Status")).upper(),
            "order_type": clean(r.get("Order Type")),
            "priority": clean(r.get("Priority Queue")),
            "product_id": clean(r.get("Product Number")),
            "product_name": clean(r.get("Product Name")),
            "library_id": clean(r.get("Library Number")),
            "library_name": clean(r.get("Library Name")) or "Unassigned",
            "city": clean(r.get("City")),
            "user_id": clean(r.get("User Number")),
            "user_name": clean(r.get("User Name")),
            "available_inventory": inv_num,
            "expected_delivery_date": clean(r.get("Expected Delivery Date")),
            "order_placed_on": clean(r.get("Order Placed On")),
        })

    library_docs = []
    for r in sheet_records(library_ws):
        library_docs.append({
            "library_number": clean(r.get("library_number")),
            "name": clean(r.get("name")),
            "lat_long": clean(r.get("lat_long")),
        })

    await db.orders.delete_many({})
    await db.returns.delete_many({})
    await db.serviceable.delete_many({})
    await db.libraries.delete_many({})
    if order_docs:
        await db.orders.insert_many(order_docs)
    if return_docs:
        await db.returns.insert_many(return_docs)
    if serviceable_docs:
        await db.serviceable.insert_many(serviceable_docs)
    if library_docs:
        await db.libraries.insert_many(library_docs)

    meta = {
        "_id": "sync",
        "sheet_url": sheet_url,
        "synced_at": datetime.now(timezone.utc).isoformat(),
        "orders_count": len(order_docs),
        "returns_count": len(return_docs),
        "serviceable_count": len(serviceable_docs),
        "libraries_count": len(library_docs),
    }
    await db.sync_meta.replace_one({"_id": "sync"}, meta, upsert=True)
    meta.pop("_id", None)
    return meta


@api_router.get("/sync/status")
async def sync_status():
    meta = await db.sync_meta.find_one({"_id": "sync"}, {"_id": 0})
    if not meta:
        return {"synced": False, "sheet_url": DEFAULT_SHEET_URL}
    meta["synced"] = True
    return meta


# ----------------------------- planning -----------------------------

async def serviceable_map():
    out = {}
    async for d in db.serviceable.find({}, {"_id": 0, "order_id": 1, "serviceability": 1}):
        out[d["order_id"]] = d.get("serviceability", "")
    return out


def parse_plan_date(value):
    if not value:
        return datetime.now(timezone.utc).date()
    try:
        return date.fromisoformat(value)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")


async def build_plan(plan_date: date, full: bool = False):
    target_delivery = plan_date + timedelta(days=2)
    return_request_date = plan_date - timedelta(days=2)
    plan_iso = plan_date.isoformat()
    target_iso = target_delivery.isoformat()
    return_iso = return_request_date.isoformat()

    svc = await serviceable_map()

    order_proj = None if full else {
        "_id": 0, "order_id": 1, "toy_name": 1, "toy_type": 1, "user_name": 1,
        "pincode": 1, "order_status": 1, "expected_delivery_date": 1, "tags": 1,
        "delivery_date": 1, "library_name": 1, "library_id": 1,
    }
    return_proj = None if full else {
        "_id": 0, "return_order": 1, "order_id": 1, "product_name": 1, "user_name": 1,
        "pincode": 1, "owner_library_name": 1, "receiving_library_name": 1,
        "return_created_at": 1, "toy_condition": 1, "request_date": 1,
        "hub_name": 1, "receiving_library": 1,
    }

    # Orders: scheduled (delivery in exactly 2 days) + overdue (delivery date
    # already passed and order is still not delivered / shipped).
    order_query = {
        "$or": [
            {"delivery_date": target_iso},
            {
                "delivery_date": {"$lt": plan_iso, "$ne": None},
                "order_status": {"$nin": ["DELIVERED", "SHIPPED"]},
            },
        ]
    }
    order_list = []
    async for o in db.orders.find(order_query, order_proj if order_proj else {"_id": 0}):
        o["serveable_status"] = svc.get(o["order_id"], "")
        o["is_overdue"] = bool(o.get("delivery_date") and o["delivery_date"] < plan_iso)
        o["plan_status"] = "Overdue" if o["is_overdue"] else "Scheduled"
        order_list.append(o)
    order_list.sort(key=lambda x: (not x["is_overdue"], x.get("delivery_date") or "9999"))

    # Returns (RETURN_REQUESTED): scheduled (requested exactly 2 days ago) +
    # overdue (requested earlier, i.e. request date + 2 days already passed).
    return_list = []
    async for r in db.returns.find({"return_status": "RETURN_REQUESTED", "request_date": {"$lte": return_iso, "$ne": None}}, return_proj if return_proj else {"_id": 0}):
        r["is_overdue"] = bool(r.get("request_date") and r["request_date"] < return_iso)
        r["plan_status"] = "Overdue" if r["is_overdue"] else "Scheduled"
        return_list.append(r)
    return_list.sort(key=lambda x: (not x["is_overdue"], x.get("request_date") or "9999"))

    hubs = {}

    def ensure(name):
        if name not in hubs:
            hubs[name] = {"hub_name": name, "hub_code": "", "orders": [], "returns": []}
        return hubs[name]

    for o in order_list:
        h = ensure(o["library_name"] or "Unassigned")
        if not h["hub_code"] and o.get("library_id"):
            h["hub_code"] = o["library_id"]
        h["orders"].append(o)

    for r in return_list:
        h = ensure(r["hub_name"] or "Unassigned")
        if not h["hub_code"] and r.get("receiving_library"):
            h["hub_code"] = r.get("receiving_library")
        h["returns"].append(r)

    hub_list = []
    for h in hubs.values():
        h["order_count"] = len(h["orders"])
        h["return_count"] = len(h["returns"])
        h["order_overdue_count"] = sum(1 for o in h["orders"] if o.get("is_overdue"))
        h["return_overdue_count"] = sum(1 for r in h["returns"] if r.get("is_overdue"))
        hub_list.append(h)
    hub_list.sort(key=lambda x: (-(x["order_count"] + x["return_count"]), x["hub_name"]))

    return {
        "plan_date": plan_date.isoformat(),
        "target_delivery_date": target_delivery.isoformat(),
        "return_request_date": return_request_date.isoformat(),
        "totals": {
            "hubs": len(hub_list),
            "orders": len(order_list),
            "returns": len(return_list),
            "orders_overdue": sum(1 for o in order_list if o.get("is_overdue")),
            "returns_overdue": sum(1 for r in return_list if r.get("is_overdue")),
        },
        "hubs": hub_list,
    }


@api_router.get("/plan")
async def get_plan(date: str | None = Query(default=None)):
    plan_date = parse_plan_date(date)
    return await build_plan(plan_date)


# ----------------------------- order confirmation -----------------------------

async def build_confirmation():
    """
    Two operational lists, grouped by warehouse (serving library):
      1. ready_to_confirm  -> Fully Serviceable PLACED orders (stock available,
         move PLACED -> CONFIRMED and send to WH).
      2. awaiting_return   -> Not Serviceable PLACED orders whose toy has a
         pending (not-yet-confirmed) return coming back to that same WH; they
         become confirmable once that return is marked RETURN_CONFIRMED.
    """
    # Index pending returns by (product_id, library_code) using both the
    # owner library (home of the toy) and the receiving library.
    returns_by_key = {}
    async for r in db.returns.find(
        {},
        {"_id": 0, "product_id": 1, "owner_library": 1, "receiving_library": 1,
         "owner_library_name": 1, "receiving_library_name": 1, "return_order": 1,
         "return_status": 1, "product_name": 1, "return_created_at": 1},
    ):
        pid = r.get("product_id")
        if not pid:
            continue
        info = {
            "return_order": r.get("return_order"),
            "return_status": r.get("return_status"),
            "product_name": r.get("product_name"),
            "return_created_at": r.get("return_created_at"),
            "library_name": r.get("receiving_library_name") or r.get("owner_library_name"),
        }
        for lib in {r.get("owner_library"), r.get("receiving_library")}:
            if lib:
                returns_by_key.setdefault((pid, lib), []).append(info)

    hubs = {}

    def ensure(name, code):
        if name not in hubs:
            hubs[name] = {"hub_name": name, "hub_code": code or "", "ready_to_confirm": [], "awaiting_return": []}
        elif code and not hubs[name]["hub_code"]:
            hubs[name]["hub_code"] = code
        return hubs[name]

    ready_total = 0
    awaiting_total = 0

    async for s in db.serviceable.find({}, {"_id": 0}):
        svc = (s.get("serviceability") or "").lower()
        lib_name = s.get("library_name") or "Unassigned"
        lib_code = s.get("library_id") or ""
        base = {
            "order_id": s.get("order_id"),
            "product_id": s.get("product_id"),
            "product_name": s.get("product_name"),
            "user_name": s.get("user_name"),
            "order_type": s.get("order_type"),
            "available_inventory": s.get("available_inventory", 0),
            "expected_delivery_date": s.get("expected_delivery_date"),
            "order_status": s.get("order_status"),
        }
        if "fully" in svc:
            ensure(lib_name, lib_code)["ready_to_confirm"].append(base)
            ready_total += 1
        elif "not" in svc or "partial" in svc:
            matches = returns_by_key.get((s.get("product_id"), s.get("library_id")), [])
            if matches:
                item = dict(base)
                item["matching_returns"] = matches
                ensure(lib_name, lib_code)["awaiting_return"].append(item)
                awaiting_total += 1

    hub_list = []
    for h in hubs.values():
        h["ready_count"] = len(h["ready_to_confirm"])
        h["awaiting_count"] = len(h["awaiting_return"])
        hub_list.append(h)
    hub_list.sort(key=lambda x: (-(x["ready_count"] + x["awaiting_count"]), x["hub_name"]))

    return {
        "totals": {
            "hubs": len(hub_list),
            "ready_to_confirm": ready_total,
            "awaiting_return": awaiting_total,
        },
        "hubs": hub_list,
    }


@api_router.get("/confirmation")
async def get_confirmation():
    return await build_confirmation()



# ----------------------------- excel export -----------------------------

ORDER_COLUMNS = [
    ("order_id", "Order Id"),
    ("plan_status", "Plan Status"),
    ("toy_name", "Toy Name"),
    ("toy_type", "Toy Type"),
    ("user_name", "User Name"),
    ("pincode", "Pincode"),
    ("order_status", "Order Status"),
    ("expected_delivery_date", "Expected Delivery Date"),
    ("serveable_status", "Serviceable Status"),
    ("is_pre_order", "Is Pre Order"),
    ("is_force_order", "Is Force Order"),
    ("delivery_partner", "Delivery Partner"),
    ("tags", "Tags"),
]

RETURN_COLUMNS = [
    ("return_order", "Return Order"),
    ("plan_status", "Plan Status"),
    ("order_id", "Order Id"),
    ("product_name", "Product Name"),
    ("user_name", "User Name"),
    ("pincode", "Pincode"),
    ("owner_library_name", "Owner Hub"),
    ("receiving_library_name", "Receiving Hub"),
    ("return_created_at", "Return Requested At"),
    ("toy_condition", "Toy Condition"),
    ("tags", "Tags"),
]

HEADER_FILL = openpyxl.styles.PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid")
HEADER_FONT = openpyxl.styles.Font(color="FFFFFF", bold=True)
SECTION_FONT = openpyxl.styles.Font(bold=True, size=12)


def _safe_sheet_name(name, used):
    invalid = set('[]:*?/\\')
    cleaned = "".join(c for c in name if c not in invalid).strip() or "Hub"
    cleaned = cleaned[:28]
    base = cleaned
    i = 1
    while cleaned.lower() in used:
        cleaned = f"{base[:25]}_{i}"
        i += 1
    used.add(cleaned.lower())
    return cleaned


def _autosize(ws):
    for col in ws.columns:
        length = 0
        letter = None
        for cell in col:
            if letter is None:
                letter = cell.column_letter
            try:
                length = max(length, len(str(cell.value)) if cell.value is not None else 0)
            except Exception:
                pass
        if letter:
            ws.column_dimensions[letter].width = min(max(length + 2, 10), 45)


def _write_hub_sheet(ws, hub, plan):
    row = 1
    ws.cell(row=row, column=1, value=f"{hub['hub_name']}  ({hub.get('hub_code','')})").font = openpyxl.styles.Font(bold=True, size=14)
    row += 1
    ws.cell(row=row, column=1, value=f"Plan Date: {plan['plan_date']}   |   Delivery Date: {plan['target_delivery_date']}   |   Return Requested On: {plan['return_request_date']}")
    row += 2

    ws.cell(row=row, column=1, value=f"ORDERS TO DELIVER ({hub['order_count']})").font = SECTION_FONT
    row += 1
    for ci, (_, label) in enumerate(ORDER_COLUMNS, start=1):
        c = ws.cell(row=row, column=ci, value=label)
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
    row += 1
    for o in hub["orders"]:
        for ci, (key, _) in enumerate(ORDER_COLUMNS, start=1):
            ws.cell(row=row, column=ci, value=o.get(key, ""))
        row += 1
    row += 2

    ws.cell(row=row, column=1, value=f"RETURNS TO PICK UP ({hub['return_count']})").font = SECTION_FONT
    row += 1
    for ci, (_, label) in enumerate(RETURN_COLUMNS, start=1):
        c = ws.cell(row=row, column=ci, value=label)
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
    row += 1
    for r in hub["returns"]:
        for ci, (key, _) in enumerate(RETURN_COLUMNS, start=1):
            ws.cell(row=row, column=ci, value=r.get(key, ""))
        row += 1
    _autosize(ws)


def build_workbook(plan, single_hub=None):
    wb = openpyxl.Workbook()
    used = set()

    hubs = plan["hubs"]
    if single_hub is not None:
        hubs = [h for h in plan["hubs"] if h["hub_name"] == single_hub]
        if not hubs:
            raise HTTPException(status_code=404, detail="Hub not found in plan")

    if single_hub is None:
        ws = wb.active
        ws.title = _safe_sheet_name("Summary", used)
        ws.cell(row=1, column=1, value="LAST MILE DAILY PLAN").font = openpyxl.styles.Font(bold=True, size=16)
        ws.cell(row=2, column=1, value=f"Plan Date: {plan['plan_date']}")
        ws.cell(row=3, column=1, value=f"Delivery Date (+2 days): {plan['target_delivery_date']}")
        ws.cell(row=4, column=1, value=f"Returns Requested On (-2 days): {plan['return_request_date']}")
        ws.cell(row=6, column=1, value=f"Total Hubs: {plan['totals']['hubs']}   Total Orders: {plan['totals']['orders']}   Total Returns: {plan['totals']['returns']}")
        head_row = 8
        for ci, label in enumerate(["Hub", "Hub Code", "Orders", "Returns", "Total"], start=1):
            c = ws.cell(row=head_row, column=ci, value=label)
            c.fill = HEADER_FILL
            c.font = HEADER_FONT
        rr = head_row + 1
        for h in plan["hubs"]:
            ws.cell(row=rr, column=1, value=h["hub_name"])
            ws.cell(row=rr, column=2, value=h.get("hub_code", ""))
            ws.cell(row=rr, column=3, value=h["order_count"])
            ws.cell(row=rr, column=4, value=h["return_count"])
            ws.cell(row=rr, column=5, value=h["order_count"] + h["return_count"])
            rr += 1
        _autosize(ws)
        for h in hubs:
            sheet = wb.create_sheet(title=_safe_sheet_name(h["hub_name"], used))
            _write_hub_sheet(sheet, h, plan)
    else:
        h = hubs[0]
        ws = wb.active
        ws.title = _safe_sheet_name(h["hub_name"], used)
        _write_hub_sheet(ws, h, plan)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


@api_router.get("/plan/export")
async def export_plan(date: str | None = Query(default=None)):
    plan_date = parse_plan_date(date)
    plan = await build_plan(plan_date, full=True)
    buf = build_workbook(plan)
    fname = f"last_mile_plan_{plan['plan_date']}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@api_router.get("/plan/export/hub")
async def export_hub(hub: str, date: str | None = Query(default=None)):
    plan_date = parse_plan_date(date)
    plan = await build_plan(plan_date, full=True)
    buf = build_workbook(plan, single_hub=hub)
    safe = re.sub(r"[^A-Za-z0-9]+", "_", hub).strip("_")
    fname = f"plan_{safe}_{plan['plan_date']}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


CONFIRM_READY_COLUMNS = [
    ("order_id", "Order Id"),
    ("product_name", "Product Name"),
    ("product_id", "Product Id"),
    ("user_name", "User Name"),
    ("order_type", "Order Type"),
    ("available_inventory", "Available Inventory"),
    ("expected_delivery_date", "Expected Delivery Date"),
    ("order_status", "Current Status"),
]

CONFIRM_AWAIT_COLUMNS = [
    ("order_id", "Order Id"),
    ("product_name", "Product Name"),
    ("product_id", "Product Id"),
    ("user_name", "User Name"),
    ("order_type", "Order Type"),
    ("available_inventory", "Available Inventory"),
    ("returns_summary", "Pending Returns To Confirm"),
]


def _write_confirmation_sheet(ws, hub):
    row = 1
    ws.cell(row=row, column=1, value=f"{hub['hub_name']}  ({hub.get('hub_code','')})").font = openpyxl.styles.Font(bold=True, size=14)
    row += 2

    ws.cell(row=row, column=1, value=f"READY TO CONFIRM — SEND TO WH ({hub['ready_count']})").font = SECTION_FONT
    row += 1
    for ci, (_, label) in enumerate(CONFIRM_READY_COLUMNS, start=1):
        c = ws.cell(row=row, column=ci, value=label)
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
    row += 1
    for o in hub["ready_to_confirm"]:
        for ci, (key, _) in enumerate(CONFIRM_READY_COLUMNS, start=1):
            ws.cell(row=row, column=ci, value=o.get(key, ""))
        row += 1
    row += 2

    ws.cell(row=row, column=1, value=f"AWAITING RETURN CONFIRMATION ({hub['awaiting_count']})").font = SECTION_FONT
    row += 1
    for ci, (_, label) in enumerate(CONFIRM_AWAIT_COLUMNS, start=1):
        c = ws.cell(row=row, column=ci, value=label)
        c.fill = HEADER_FILL
        c.font = HEADER_FONT
    row += 1
    for o in hub["awaiting_return"]:
        summary = "; ".join(
            f"{m.get('return_order')} ({m.get('return_status')})" for m in o.get("matching_returns", [])
        )
        vals = dict(o)
        vals["returns_summary"] = summary
        for ci, (key, _) in enumerate(CONFIRM_AWAIT_COLUMNS, start=1):
            ws.cell(row=row, column=ci, value=vals.get(key, ""))
        row += 1
    _autosize(ws)


def build_confirmation_workbook(conf, single_hub=None):
    wb = openpyxl.Workbook()
    used = set()
    hubs = conf["hubs"]
    if single_hub is not None:
        hubs = [h for h in conf["hubs"] if h["hub_name"] == single_hub]
        if not hubs:
            raise HTTPException(status_code=404, detail="Hub not found")

    if single_hub is None:
        ws = wb.active
        ws.title = _safe_sheet_name("Summary", used)
        ws.cell(row=1, column=1, value="ORDER CONFIRMATION PLAN").font = openpyxl.styles.Font(bold=True, size=16)
        ws.cell(row=3, column=1, value=f"Total Hubs: {conf['totals']['hubs']}   Ready to Confirm: {conf['totals']['ready_to_confirm']}   Awaiting Return: {conf['totals']['awaiting_return']}")
        head_row = 5
        for ci, label in enumerate(["Hub", "Hub Code", "Ready to Confirm", "Awaiting Return"], start=1):
            c = ws.cell(row=head_row, column=ci, value=label)
            c.fill = HEADER_FILL
            c.font = HEADER_FONT
        rr = head_row + 1
        for h in conf["hubs"]:
            ws.cell(row=rr, column=1, value=h["hub_name"])
            ws.cell(row=rr, column=2, value=h.get("hub_code", ""))
            ws.cell(row=rr, column=3, value=h["ready_count"])
            ws.cell(row=rr, column=4, value=h["awaiting_count"])
            rr += 1
        _autosize(ws)
        for h in hubs:
            _write_confirmation_sheet(wb.create_sheet(title=_safe_sheet_name(h["hub_name"], used)), h)
    else:
        _write_confirmation_sheet(wb.active, hubs[0])
        wb.active.title = _safe_sheet_name(hubs[0]["hub_name"], used)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


@api_router.get("/confirmation/export")
async def export_confirmation():
    conf = await build_confirmation()
    buf = build_confirmation_workbook(conf)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="order_confirmation_plan.xlsx"'},
    )


@api_router.get("/confirmation/export/hub")
async def export_confirmation_hub(hub: str):
    conf = await build_confirmation()
    buf = build_confirmation_workbook(conf, single_hub=hub)
    safe = re.sub(r"[^A-Za-z0-9]+", "_", hub).strip("_")
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="confirmation_{safe}.xlsx"'},
    )



@api_router.get("/")
async def root():
    return {"message": "Last Mile Planner API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
