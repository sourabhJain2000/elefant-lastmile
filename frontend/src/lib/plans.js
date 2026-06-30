// Pure planning logic ported 1:1 from the original FastAPI backend.
// Each function takes the parsed `store` ({orders, returns, serviceable,
// libraries}) plus a plan date (ISO "YYYY-MM-DD" string) and returns the same
// shape the UI used to receive from the API.

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function addDays(iso, n) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function parsePlanDate(value) {
  return value || todayISO();
}

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function serviceableMap(store) {
  const m = {};
  for (const s of store.serviceable) m[s.order_id] = s.serviceability || "";
  return m;
}

// ----------------------------- Last Mile Plan -----------------------------

export function buildPlan(store, planDateIso) {
  const targetIso = addDays(planDateIso, 2);
  const returnIso = addDays(planDateIso, -2);
  const planIso = planDateIso;
  const svc = serviceableMap(store);

  const byOrder = {};
  for (const src of store.orders) {
    const dd = src.delivery_date;
    if (!dd || dd > targetIso) continue;
    if (src.order_status !== "PLACED" && src.order_status !== "CONFIRMED") continue;
    const oid = src.order_id;
    const existing = byOrder[oid];
    if (!existing) {
      const o = { ...src };
      o.serveable_status = svc[oid] || "";
      o.is_overdue = Boolean(dd && dd < planIso);
      o.plan_status = o.is_overdue ? "Overdue" : "Scheduled";
      o._toys = src.toy_name ? [src.toy_name] : [];
      o.item_count = 1;
      byOrder[oid] = o;
    } else {
      existing.item_count += 1;
      if (src.toy_name) existing._toys.push(src.toy_name);
    }
  }
  const orderList = Object.values(byOrder);
  for (const o of orderList) {
    const toys = [...new Set(o._toys || [])];
    delete o._toys;
    if (toys.length) o.toy_name = toys.join(", ");
  }
  orderList.sort((a, b) => {
    const ao = a.is_overdue ? 0 : 1;
    const bo = b.is_overdue ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return cmpStr(a.delivery_date || "9999", b.delivery_date || "9999");
  });

  const returnList = [];
  for (const src of store.returns) {
    if (src.return_status !== "RETURN_REQUESTED") continue;
    const rd = src.request_date;
    if (!rd || rd > returnIso) continue;
    const r = { ...src };
    r.is_overdue = Boolean(rd && rd < returnIso);
    r.plan_status = r.is_overdue ? "Overdue" : "Scheduled";
    returnList.push(r);
  }
  returnList.sort((a, b) => {
    const ao = a.is_overdue ? 0 : 1;
    const bo = b.is_overdue ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return cmpStr(a.request_date || "9999", b.request_date || "9999");
  });

  const hubs = {};
  const ensure = (name) => {
    if (!hubs[name]) hubs[name] = { hub_name: name, hub_code: "", orders: [], returns: [] };
    return hubs[name];
  };
  for (const o of orderList) {
    const h = ensure(o.library_name || "Unassigned");
    if (!h.hub_code && o.library_id) h.hub_code = o.library_id;
    h.orders.push(o);
  }
  for (const r of returnList) {
    const h = ensure(r.hub_name || "Unassigned");
    if (!h.hub_code && r.receiving_library) h.hub_code = r.receiving_library;
    h.returns.push(r);
  }

  const hubList = Object.values(hubs).map((h) => ({
    ...h,
    order_count: h.orders.length,
    return_count: h.returns.length,
    order_overdue_count: h.orders.filter((o) => o.is_overdue).length,
    return_overdue_count: h.returns.filter((r) => r.is_overdue).length,
  }));
  hubList.sort((a, b) => {
    const d = b.order_count + b.return_count - (a.order_count + a.return_count);
    if (d) return d;
    return cmpStr(a.hub_name, b.hub_name);
  });

  return {
    plan_date: planDateIso,
    target_delivery_date: targetIso,
    return_request_date: returnIso,
    totals: {
      hubs: hubList.length,
      orders: orderList.length,
      returns: returnList.length,
      orders_overdue: orderList.filter((o) => o.is_overdue).length,
      returns_overdue: returnList.filter((r) => r.is_overdue).length,
    },
    hubs: hubList,
  };
}

// ----------------------------- Order Confirmation -----------------------------

export function buildConfirmation(store, planDateIso) {
  const targetIso = planDateIso ? addDays(planDateIso, 2) : null;
  const hubs = {};
  const ensure = (name, code) => {
    if (!hubs[name]) hubs[name] = { hub_name: name, hub_code: code || "", ready_to_confirm: [] };
    else if (code && !hubs[name].hub_code) hubs[name].hub_code = code;
    return hubs[name];
  };

  let readyTotal = 0;
  for (const s of store.serviceable) {
    if (!(s.serviceability || "").toLowerCase().includes("fully")) continue;
    if (targetIso != null) {
      const dd = s.delivery_date;
      if (!dd || dd > targetIso) continue;
    }
    const libName = s.library_name || "Unassigned";
    ensure(libName, s.library_id || "").ready_to_confirm.push({
      order_id: s.order_id,
      product_id: s.product_id,
      product_name: s.product_name,
      user_name: s.user_name,
      order_type: s.order_type,
      available_inventory: s.available_inventory,
      expected_delivery_date: s.expected_delivery_date,
      order_status: s.order_status,
    });
    readyTotal += 1;
  }

  const hubList = Object.values(hubs).map((h) => ({ ...h, ready_count: h.ready_to_confirm.length }));
  hubList.sort((a, b) => {
    const d = b.ready_count - a.ready_count;
    if (d) return d;
    return cmpStr(a.hub_name, b.hub_name);
  });

  return {
    totals: { hubs: hubList.length, ready_to_confirm: readyTotal },
    plan_date: planDateIso || null,
    target_delivery_date: targetIso,
    hubs: hubList,
  };
}

// ----------------------------- Confirm via Returns -----------------------------

const CONFIRMABLE_RETURN_STATUSES = new Set(["PICKED_UP", "RETURNED", "ARRIVED"]);

export function buildReturnConfirmation(store) {
  const returnsByKey = {};
  for (const r of store.returns) {
    if (!CONFIRMABLE_RETURN_STATUSES.has(r.return_status)) continue;
    const pid = r.product_id;
    const lib = r.owner_library || r.receiving_library;
    if (!pid || !lib) continue;
    const key = `${pid}|${lib}`;
    (returnsByKey[key] = returnsByKey[key] || []).push({
      return_order: r.return_order,
      return_status: r.return_status,
    });
  }

  const ordersByKey = {};
  for (const s of store.serviceable) {
    const svc = (s.serviceability || "").toLowerCase();
    if (!svc.includes("not") && !svc.includes("partial")) continue;
    const key = `${s.product_id}|${s.library_id}`;
    if (!(key in returnsByKey)) continue;
    (ordersByKey[key] = ordersByKey[key] || []).push(s);
  }

  const allocated = [];
  for (const [key, cand] of Object.entries(ordersByKey)) {
    const avail = returnsByKey[key] || [];
    cand.sort((a, b) => {
      const d = cmpStr(a.delivery_date || "9999-12-31", b.delivery_date || "9999-12-31");
      if (d) return d;
      return cmpStr(a.order_id || "", b.order_id || "");
    });
    for (let i = 0; i < cand.length; i++) {
      if (i >= avail.length) break;
      const s = cand[i];
      allocated.push({
        order_id: s.order_id,
        product_id: s.product_id,
        product_name: s.product_name,
        user_name: s.user_name,
        order_type: s.order_type,
        library_name: s.library_name || "Unassigned",
        library_id: s.library_id || "",
        expected_delivery_date: s.expected_delivery_date,
        delivery_date: s.delivery_date,
        matching_returns: [avail[i]],
      });
    }
  }

  allocated.sort((a, b) => {
    let d = cmpStr(a.library_name, b.library_name);
    if (d) return d;
    d = cmpStr(a.delivery_date || "9999-12-31", b.delivery_date || "9999-12-31");
    if (d) return d;
    return cmpStr(a.order_id, b.order_id);
  });
  return { totals: { orders: allocated.length }, orders: allocated };
}

// ----------------------------- Unallocatable / Pickup -----------------------------

const COVERABLE_RETURN_STATUSES = new Set([
  "RETURN_REQUESTED",
  "READY_TO_PICKUP",
  "PICKED_UP",
  "RETURNED",
  "ARRIVED",
]);
const PICKUP_RETURN_STATUSES = new Set(["RETURN_REQUESTED", "READY_TO_PICKUP"]);

function notServiceableGroups(store) {
  const groups = {};
  for (const s of store.serviceable) {
    const svc = (s.serviceability || "").toLowerCase();
    if (!svc.includes("not") && !svc.includes("partial")) continue;
    const key = `${s.product_id}|${s.library_id}`;
    (groups[key] = groups[key] || []).push(s);
  }
  for (const cand of Object.values(groups)) {
    cand.sort((a, b) => {
      const d = cmpStr(a.delivery_date || "9999-12-31", b.delivery_date || "9999-12-31");
      if (d) return d;
      return cmpStr(a.order_id || "", b.order_id || "");
    });
  }
  return groups;
}

export function buildUnallocatable(store, planDateIso) {
  const targetIso = planDateIso ? addDays(planDateIso, 2) : null;

  const supply = {};
  for (const r of store.returns) {
    if (!COVERABLE_RETURN_STATUSES.has(r.return_status)) continue;
    const lib = r.owner_library || r.receiving_library;
    const pid = r.product_id;
    if (pid && lib) {
      const key = `${pid}|${lib}`;
      supply[key] = (supply[key] || 0) + 1;
    }
  }

  const groups = notServiceableGroups(store);
  const out = [];
  for (const [key, cand] of Object.entries(groups)) {
    const sup = supply[key] || 0;
    for (let i = 0; i < cand.length; i++) {
      if (i < sup) continue;
      const s = cand[i];
      const dd = s.delivery_date;
      if (targetIso != null && (!dd || dd > targetIso)) continue;
      out.push({
        order_id: s.order_id,
        product_id: s.product_id,
        product_name: s.product_name,
        user_name: s.user_name,
        order_type: s.order_type,
        library_name: s.library_name || "Unassigned",
        library_id: s.library_id || "",
        available_inventory: s.available_inventory || 0,
        expected_delivery_date: s.expected_delivery_date,
        delivery_date: dd,
      });
    }
  }
  out.sort((a, b) => {
    let d = cmpStr(a.library_name, b.library_name);
    if (d) return d;
    d = cmpStr(a.delivery_date || "9999-12-31", b.delivery_date || "9999-12-31");
    if (d) return d;
    return cmpStr(a.order_id, b.order_id);
  });
  return {
    totals: { orders: out.length },
    plan_date: planDateIso || null,
    target_delivery_date: targetIso,
    orders: out,
  };
}

export function buildPickupPlan(store, planDateIso, windowDays = 5) {
  const cutoffIso = addDays(planDateIso, windowDays);

  const pickups = {};
  for (const r of store.returns) {
    if (!PICKUP_RETURN_STATUSES.has(r.return_status)) continue;
    const lib = r.owner_library || r.receiving_library;
    const pid = r.product_id;
    if (pid && lib) {
      const key = `${pid}|${lib}`;
      (pickups[key] = pickups[key] || []).push(r);
    }
  }

  const groups = notServiceableGroups(store);
  const rows = [];
  for (const [key, cand] of Object.entries(groups)) {
    const avail = pickups[key] || [];
    if (!avail.length) continue;
    const near = cand.filter((s) => s.delivery_date && s.delivery_date <= cutoffIso);
    for (let i = 0; i < near.length; i++) {
      if (i >= avail.length) break;
      const s = near[i];
      const r = avail[i];
      rows.push({
        return_order: r.return_order,
        return_status: r.return_status,
        product_name: s.product_name,
        library_name: s.library_name || "Unassigned",
        library_id: s.library_id || "",
        for_order: s.order_id,
        user_name: s.user_name,
        order_type: s.order_type,
        order_delivery_date: s.delivery_date,
        expected_delivery_date: s.expected_delivery_date,
      });
    }
  }
  rows.sort((a, b) => {
    const d = cmpStr(a.order_delivery_date || "9999-12-31", b.order_delivery_date || "9999-12-31");
    if (d) return d;
    return cmpStr(a.for_order, b.for_order);
  });
  return {
    totals: { pickups: rows.length },
    plan_date: planDateIso,
    window_days: windowDays,
    cutoff_date: cutoffIso,
    pickups: rows,
  };
}
