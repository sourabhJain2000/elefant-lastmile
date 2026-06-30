// Reads the Google Sheet directly in the browser (no backend).
// The full workbook is downloaded as .xlsx and parsed with ExcelJS, exactly
// mirroring the original backend `_parse_workbook` logic.
import ExcelJS from "exceljs";

export const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1Q7eGyhFSp-GuhqSMFGMvsE-XOQp8o5Hrm1Cwl4vw1YM/edit?gid=1958626721#gid=1958626721";

const DELIVERED_STATUSES = new Set(["DELIVERED"]);

export function extractSheetId(url) {
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]+)/.exec(url || "");
  if (!m) throw new Error("Invalid Google Sheet URL");
  return m[1];
}

// Normalise an ExcelJS cell value to a primitive (string | number | Date).
function norm(v) {
  if (v == null) return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text != null) return v.text;
    if (v.result != null) return v.result;
    if (v.hyperlink != null) return v.hyperlink;
    return "";
  }
  return v;
}

function clean(v) {
  const n = norm(v);
  if (n == null) return "";
  if (typeof n === "number") return String(n);
  if (n instanceof Date) return n.toISOString().slice(0, 10);
  return String(n).trim();
}

function toDateStr(v) {
  const n = norm(v);
  if (n == null) return null;
  if (n instanceof Date) return n.toISOString().slice(0, 10);
  const s = String(n).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); // d/m/Y
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

function intOf(v) {
  const n = norm(v);
  if (n === "" || n == null) return 0;
  const num = Number(n);
  return Number.isFinite(num) ? Math.trunc(num) : 0;
}

function findSheet(wb, ...keywords) {
  for (const ws of wb.worksheets) {
    const t = (ws.name || "").toLowerCase();
    if (keywords.every((k) => t.includes(k.toLowerCase()))) return ws;
  }
  return null;
}

// Replicates backend sheet_records: header from row 1, skip empty/duplicate
// header columns, skip fully-empty rows.
function sheetRecords(ws) {
  if (!ws) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row) => rows.push(row.values));
  if (!rows.length) return [];
  const headerRow = rows[0];
  const header = [];
  for (let i = 1; i < headerRow.length; i++) {
    const h = norm(headerRow[i]);
    header.push(h == null ? "" : String(h).trim());
  }
  const out = [];
  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const rec = {};
    let empty = true;
    for (let ci = 0; ci < header.length; ci++) {
      const h = header[ci];
      if (!h || h in rec) continue;
      const v = r[ci + 1];
      const nv = norm(v);
      if (nv != null && String(nv).trim() !== "") empty = false;
      rec[h] = v;
    }
    if (!empty) out.push(rec);
  }
  return out;
}

async function fetchWorkbook(sheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx`;
  let res;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch (e) {
    throw new Error(
      "Could not reach the Google Sheet. Make sure it is shared as 'Anyone with the link'."
    );
  }
  if (!res.ok) {
    throw new Error(
      `Could not fetch the Google Sheet (HTTP ${res.status}). Make sure it is shared as 'Anyone with the link'.`
    );
  }
  const buf = await res.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

// Returns { orders, returns, serviceable, libraries }.
export async function parseWorkbook(sheetUrl) {
  const sheetId = extractSheetId(sheetUrl || DEFAULT_SHEET_URL);
  const wb = await fetchWorkbook(sheetId);

  const ordersWs = findSheet(wb, "order") || wb.worksheets[0];
  const returnsWs = findSheet(wb, "return");
  const serviceableWs = findSheet(wb, "serviceable") || findSheet(wb, "servic");
  const libraryWs = findSheet(wb, "librar");

  const orders = [];
  for (const r of sheetRecords(ordersWs)) {
    const status = clean(r["Order Status"]).toUpperCase();
    if (DELIVERED_STATUSES.has(status)) continue;
    orders.push({
      order_id: clean(r["Order Id"]),
      product_id: clean(r["Product Id"]),
      toy_name: clean(r["Toy Name"]),
      library_id: clean(r["Library Id"]),
      library_name: clean(r["Library Name"]) || "Unassigned",
      user_id: clean(r["User Id"]),
      user_name: clean(r["User Name"]),
      pincode: clean(r["Pincode"]),
      plan_type: clean(r["Plan Type"]),
      order_status: status,
      expected_delivery_date: clean(r["Expected Delivery Date"]),
      delivery_date: toDateStr(r["Expected Delivery Date"]),
      delivery_type: clean(r["Delivery Type"]),
      delivery_partner: clean(r["Delivery Partner"]),
      toy_type: clean(r["Toy Type"]),
      is_pre_order: clean(r["Is Pre ORder"]),
      is_force_order: clean(r["Is Force Order"]),
      tags: clean(r["Tags"]),
    });
  }

  const returns = [];
  for (const r of sheetRecords(returnsWs)) {
    const status = clean(r["Return Order Status"]).toUpperCase();
    if (!status || status === "RETURN_CONFIRMED") continue;
    const receiving = clean(r["Receiving Library Name"]);
    const owner = clean(r["Owner Library Name"]);
    const hub = receiving || owner || "Unassigned";
    returns.push({
      return_order: clean(r["Return Order"]),
      order_id: clean(r["Order Id"]),
      product_id: clean(r["Product Id"]),
      product_name: clean(r["Product Name"]),
      owner_library: clean(r["Owner Library"]),
      owner_library_name: owner,
      receiving_library: clean(r["Receiving Library"]),
      receiving_library_name: receiving,
      hub_name: hub,
      user_id: clean(r["User Id"]),
      user_name: clean(r["User Name"]),
      pincode: clean(r["Pincode"]),
      plan_type: clean(r["Plan Type"]),
      return_status: status,
      toy_condition: clean(r["Toy Condition"]),
      return_created_at: clean(r["Return Created At"]),
      request_date: toDateStr(r["Return Created At"]),
      is_pre_order: clean(r["Is Pre Order"]),
      is_force_order: clean(r["Is Force Order"]),
      tags: clean(r["Tags"]),
    });
  }

  const serviceable = [];
  const seen = new Set();
  for (const r of sheetRecords(serviceableWs)) {
    const oid = clean(r["Order Number"]) || clean(r["order_id"]);
    if (!oid || seen.has(oid)) continue;
    seen.add(oid);
    const svcRaw = clean(r["Serviceability"]) || clean(r["Serveable Status"]);
    serviceable.push({
      order_id: oid,
      serviceability: svcRaw,
      order_status: clean(r["Order Status"]).toUpperCase(),
      order_type: clean(r["Order Type"]),
      priority: clean(r["Priority Queue"]),
      product_id: clean(r["Product Number"]),
      product_name: clean(r["Product Name"]),
      library_id: clean(r["Library Number"]),
      library_name: clean(r["Library Name"]) || "Unassigned",
      city: clean(r["City"]),
      user_id: clean(r["User Number"]),
      user_name: clean(r["User Name"]),
      available_inventory: intOf(r["Available Inventory"]),
      expected_delivery_date: clean(r["Expected Delivery Date"]),
      delivery_date: toDateStr(r["Expected Delivery Date"]),
      order_placed_on: clean(r["Order Placed On"]),
    });
  }

  const libraries = [];
  for (const r of sheetRecords(libraryWs)) {
    libraries.push({
      library_number: clean(r["library_number"]),
      name: clean(r["name"]),
      lat_long: clean(r["lat_long"]),
    });
  }

  return { orders, returns, serviceable, libraries };
}
