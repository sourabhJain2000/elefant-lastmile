// Client-side Excel export with ExcelJS, mirroring the original openpyxl output.
import ExcelJS from "exceljs";

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
const HEADER_FONT = { color: { argb: "FFFFFFFF" }, bold: true };
const SECTION_FONT = { bold: true, size: 12 };

const ORDER_COLUMNS = [
  ["order_id", "Order Id"],
  ["plan_status", "Plan Status"],
  ["toy_name", "Toy Name"],
  ["item_count", "Items"],
  ["toy_type", "Toy Type"],
  ["user_name", "User Name"],
  ["pincode", "Pincode"],
  ["order_status", "Order Status"],
  ["expected_delivery_date", "Expected Delivery Date"],
  ["serveable_status", "Serviceable Status"],
  ["is_pre_order", "Is Pre Order"],
  ["is_force_order", "Is Force Order"],
  ["delivery_partner", "Delivery Partner"],
  ["tags", "Tags"],
];

const RETURN_COLUMNS = [
  ["return_order", "Return Order"],
  ["plan_status", "Plan Status"],
  ["order_id", "Order Id"],
  ["product_name", "Product Name"],
  ["user_name", "User Name"],
  ["pincode", "Pincode"],
  ["owner_library_name", "Owner Hub"],
  ["receiving_library_name", "Receiving Hub"],
  ["return_created_at", "Return Requested At"],
  ["toy_condition", "Toy Condition"],
  ["tags", "Tags"],
];

const CONFIRM_READY_COLUMNS = [
  ["order_id", "Order Id"],
  ["product_name", "Product Name"],
  ["product_id", "Product Id"],
  ["user_name", "User Name"],
  ["order_type", "Order Type"],
  ["available_inventory", "Available Inventory"],
  ["expected_delivery_date", "Expected Delivery Date"],
  ["order_status", "Current Status"],
];

const CONFIRM_AWAIT_COLUMNS = [
  ["order_id", "Order Id"],
  ["product_name", "Product Name"],
  ["product_id", "Product Id"],
  ["user_name", "User Name"],
  ["order_type", "Order Type"],
  ["library_name", "Warehouse"],
  ["returns_summary", "Pending Returns To Confirm"],
];

const UNALLOC_COLUMNS = [
  ["order_id", "Order Id"],
  ["product_name", "Product Name"],
  ["product_id", "Product Id"],
  ["user_name", "User Name"],
  ["order_type", "Order Type"],
  ["library_name", "Warehouse"],
  ["available_inventory", "Available Inventory"],
  ["expected_delivery_date", "Expected Delivery Date"],
];

const PICKUP_COLUMNS = [
  ["return_order", "Return Order"],
  ["return_status", "Return Status"],
  ["product_name", "Product Name"],
  ["library_name", "Warehouse"],
  ["for_order", "For Order"],
  ["user_name", "Customer"],
  ["expected_delivery_date", "Order Delivery Date"],
];

function safeSheetName(name, used) {
  const invalid = new Set(["[", "]", ":", "*", "?", "/", "\\"]);
  let cleaned =
    [...String(name || "")].filter((c) => !invalid.has(c)).join("").trim() || "Hub";
  cleaned = cleaned.slice(0, 28);
  const base = cleaned;
  let i = 1;
  while (used.has(cleaned.toLowerCase())) {
    cleaned = `${base.slice(0, 25)}_${i}`;
    i += 1;
  }
  used.add(cleaned.toLowerCase());
  return cleaned;
}

function autosize(ws) {
  ws.columns.forEach((col) => {
    let max = 0;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const l = cell.value != null ? String(cell.value).length : 0;
      if (l > max) max = l;
    });
    col.width = Math.min(Math.max(max + 2, 10), 45);
  });
}

function setHeaderRow(ws, rowIdx, columns) {
  columns.forEach(([, label], ci) => {
    const cell = ws.getRow(rowIdx).getCell(ci + 1);
    cell.value = label;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
}

function writeRows(ws, startRow, columns, rows) {
  let rr = startRow;
  for (const o of rows) {
    columns.forEach(([key], ci) => {
      ws.getRow(rr).getCell(ci + 1).value = o[key] ?? "";
    });
    rr += 1;
  }
  return rr;
}

async function download(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function writeHubSheet(ws, hub, plan) {
  let row = 1;
  let c = ws.getRow(row).getCell(1);
  c.value = `${hub.hub_name}  (${hub.hub_code || ""})`;
  c.font = { bold: true, size: 14 };
  row += 1;
  ws.getRow(row).getCell(1).value = `Plan Date: ${plan.plan_date}   |   Delivery Date: ${plan.target_delivery_date}   |   Return Requested On: ${plan.return_request_date}`;
  row += 2;

  c = ws.getRow(row).getCell(1);
  c.value = `ORDERS TO DELIVER (${hub.order_count})`;
  c.font = SECTION_FONT;
  row += 1;
  setHeaderRow(ws, row, ORDER_COLUMNS);
  row += 1;
  row = writeRows(ws, row, ORDER_COLUMNS, hub.orders);
  row += 2;

  c = ws.getRow(row).getCell(1);
  c.value = `RETURNS TO PICK UP (${hub.return_count})`;
  c.font = SECTION_FONT;
  row += 1;
  setHeaderRow(ws, row, RETURN_COLUMNS);
  row += 1;
  writeRows(ws, row, RETURN_COLUMNS, hub.returns);
  autosize(ws);
}

export async function exportPlan(plan, singleHub = null) {
  const wb = new ExcelJS.Workbook();
  const used = new Set();
  let hubs = plan.hubs;
  if (singleHub != null) hubs = plan.hubs.filter((h) => h.hub_name === singleHub);

  if (singleHub == null) {
    const ws = wb.addWorksheet(safeSheetName("Summary", used));
    ws.getRow(1).getCell(1).value = "LAST MILE DAILY PLAN";
    ws.getRow(1).getCell(1).font = { bold: true, size: 16 };
    ws.getRow(2).getCell(1).value = `Plan Date: ${plan.plan_date}`;
    ws.getRow(3).getCell(1).value = `Delivery Date (+2 days): ${plan.target_delivery_date}`;
    ws.getRow(4).getCell(1).value = `Returns Requested On (-2 days): ${plan.return_request_date}`;
    ws.getRow(6).getCell(1).value = `Total Hubs: ${plan.totals.hubs}   Total Orders: ${plan.totals.orders}   Total Returns: ${plan.totals.returns}`;
    const headRow = 8;
    ["Hub", "Hub Code", "Orders", "Returns", "Total"].forEach((label, ci) => {
      const cell = ws.getRow(headRow).getCell(ci + 1);
      cell.value = label;
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
    });
    let rr = headRow + 1;
    for (const h of plan.hubs) {
      ws.getRow(rr).getCell(1).value = h.hub_name;
      ws.getRow(rr).getCell(2).value = h.hub_code || "";
      ws.getRow(rr).getCell(3).value = h.order_count;
      ws.getRow(rr).getCell(4).value = h.return_count;
      ws.getRow(rr).getCell(5).value = h.order_count + h.return_count;
      rr += 1;
    }
    autosize(ws);
    for (const h of hubs) writeHubSheet(wb.addWorksheet(safeSheetName(h.hub_name, used)), h, plan);
  } else {
    if (!hubs.length) return;
    writeHubSheet(wb.addWorksheet(safeSheetName(hubs[0].hub_name, used)), hubs[0], plan);
  }

  const fname = singleHub
    ? `plan_${singleHub.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}_${plan.plan_date}.xlsx`
    : `last_mile_plan_${plan.plan_date}.xlsx`;
  await download(wb, fname);
}

function writeConfirmationSheet(ws, hub) {
  let row = 1;
  const c = ws.getRow(row).getCell(1);
  c.value = `${hub.hub_name}  (${hub.hub_code || ""})`;
  c.font = { bold: true, size: 14 };
  row += 2;
  const c2 = ws.getRow(row).getCell(1);
  c2.value = `READY TO CONFIRM — SEND TO WH (${hub.ready_count})`;
  c2.font = SECTION_FONT;
  row += 1;
  setHeaderRow(ws, row, CONFIRM_READY_COLUMNS);
  row += 1;
  writeRows(ws, row, CONFIRM_READY_COLUMNS, hub.ready_to_confirm);
  autosize(ws);
}

export async function exportConfirmation(conf, singleHub = null) {
  const wb = new ExcelJS.Workbook();
  const used = new Set();
  let hubs = conf.hubs;
  if (singleHub != null) hubs = conf.hubs.filter((h) => h.hub_name === singleHub);

  if (singleHub == null) {
    const ws = wb.addWorksheet(safeSheetName("Summary", used));
    ws.getRow(1).getCell(1).value = "ORDER CONFIRMATION PLAN";
    ws.getRow(1).getCell(1).font = { bold: true, size: 16 };
    ws.getRow(3).getCell(1).value = `Total Hubs: ${conf.totals.hubs}   Ready to Confirm: ${conf.totals.ready_to_confirm}`;
    const headRow = 5;
    ["Hub", "Hub Code", "Ready to Confirm"].forEach((label, ci) => {
      const cell = ws.getRow(headRow).getCell(ci + 1);
      cell.value = label;
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
    });
    let rr = headRow + 1;
    for (const h of conf.hubs) {
      ws.getRow(rr).getCell(1).value = h.hub_name;
      ws.getRow(rr).getCell(2).value = h.hub_code || "";
      ws.getRow(rr).getCell(3).value = h.ready_count;
      rr += 1;
    }
    autosize(ws);
    for (const h of hubs) writeConfirmationSheet(wb.addWorksheet(safeSheetName(h.hub_name, used)), h);
  } else {
    if (!hubs.length) return;
    writeConfirmationSheet(wb.addWorksheet(safeSheetName(hubs[0].hub_name, used)), hubs[0]);
  }

  const fname = singleHub
    ? `confirmation_${singleHub.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}.xlsx`
    : "order_confirmation_plan.xlsx";
  await download(wb, fname);
}

export async function exportReturnConfirmation(data) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Confirm via Returns");
  ws.getRow(1).getCell(1).value = "ORDERS CONFIRMABLE VIA RETURNS";
  ws.getRow(1).getCell(1).font = { bold: true, size: 16 };
  ws.getRow(2).getCell(1).value = `Total Orders: ${data.totals.orders}  (returns in PICKED_UP / RETURNED / ARRIVED status)`;
  const headRow = 4;
  setHeaderRow(ws, headRow, CONFIRM_AWAIT_COLUMNS);
  let rr = headRow + 1;
  for (const o of data.orders) {
    const summary = (o.matching_returns || [])
      .map((m) => `${m.return_order} (${m.return_status})`)
      .join("; ");
    const vals = { ...o, returns_summary: summary };
    CONFIRM_AWAIT_COLUMNS.forEach(([key], ci) => {
      ws.getRow(rr).getCell(ci + 1).value = vals[key] ?? "";
    });
    rr += 1;
  }
  autosize(ws);
  await download(wb, "confirm_via_returns.xlsx");
}

async function flatWorkbook(title, header, columns, rows, filename) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.getRow(1).getCell(1).value = title;
  ws.getRow(1).getCell(1).font = { bold: true, size: 16 };
  ws.getRow(2).getCell(1).value = header;
  const hr = 4;
  setHeaderRow(ws, hr, columns);
  writeRows(ws, hr + 1, columns, rows);
  autosize(ws);
  await download(wb, filename);
}

export async function exportUnallocatable(data) {
  const hdr =
    `Total: ${data.totals.orders}` +
    (data.target_delivery_date
      ? `  |  Expected delivery on or before ${data.target_delivery_date}`
      : "  |  All dates");
  await flatWorkbook(
    "ORDERS WITH NO INVENTORY (UNALLOCATABLE)",
    hdr,
    UNALLOC_COLUMNS,
    data.orders,
    "unallocatable_orders.xlsx"
  );
}

export async function exportPickupPlan(data) {
  const hdr = `Total returns to pick up: ${data.totals.pickups}  |  For orders delivering on or before ${data.cutoff_date} (next ${data.window_days} days)`;
  await flatWorkbook("RETURN PICKUP PLAN", hdr, PICKUP_COLUMNS, data.pickups, "return_pickup_plan.xlsx");
}
