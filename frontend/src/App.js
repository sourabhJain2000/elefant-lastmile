import { useEffect, useState, useCallback } from "react";
import "@/App.css";
import axios from "axios";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import ConfirmationView from "@/ConfirmationView";
import ReturnConfirmationView from "@/ReturnConfirmationView";
import {
  Truck,
  ArrowsClockwise,
  DownloadSimple,
  Package,
  ArrowUUpLeft,
  CalendarBlank,
  Buildings,
  CaretRight,
  Warning,
  CheckCircle,
  Spinner,
  CloudArrowDown,
} from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function TabButton({ active, onClick, testid, children }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-blue-600 text-zinc-900"
          : "border-transparent text-zinc-500 hover:text-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

function ServiceBadge({ status }) {
  const base =
    "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium border whitespace-nowrap";
  if (!status) return <span className="text-zinc-400 text-xs">—</span>;
  const s = status.toLowerCase();
  let cls = "bg-zinc-100 text-zinc-700 border-zinc-200";
  if (s.includes("fully")) cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
  else if (s.includes("partial")) cls = "bg-amber-50 text-amber-700 border-amber-200";
  else if (s.includes("not")) cls = "bg-red-50 text-red-700 border-red-200";
  return <span className={`${base} ${cls}`} data-testid="serviceable-badge">{status}</span>;
}

function StatusBadge({ status }) {
  if (!status) return <span className="text-zinc-400 text-xs">—</span>;
  return (
    <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium border bg-zinc-100 text-zinc-700 border-zinc-200 whitespace-nowrap">
      {status}
    </span>
  );
}

function Kpi({ icon, label, value, accent, sub }) {
  return (
    <div
      className="bg-white border border-zinc-200 rounded-sm p-5 flex items-center gap-4 shadow-sm relative overflow-hidden"
      data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className={`absolute left-0 top-0 h-full w-1 ${accent}`} />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
          {label}
        </span>
        <span className="text-3xl sm:text-4xl font-semibold text-zinc-900 font-mono tracking-tighter">
          {value}
        </span>
        {sub ? <span className="text-xs font-medium text-red-600">{sub}</span> : null}
      </div>
      <div className="ml-auto text-zinc-300">{icon}</div>
    </div>
  );
}

const TH = ({ children }) => (
  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-zinc-600 uppercase tracking-wider whitespace-nowrap">
    {children}
  </th>
);
const TD = ({ children, mono }) => (
  <td
    className={`px-3 py-2.5 text-sm whitespace-nowrap ${
      mono ? "font-mono text-zinc-900" : "text-zinc-700"
    }`}
  >
    {children}
  </td>
);

function OverdueBadge({ overdue }) {
  if (overdue)
    return (
      <span className="inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-semibold border bg-red-50 text-red-700 border-red-200 whitespace-nowrap" data-testid="overdue-badge">
        <Warning size={12} weight="fill" /> Overdue
      </span>
    );
  return (
    <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium border bg-emerald-50 text-emerald-700 border-emerald-200 whitespace-nowrap">
      Scheduled
    </span>
  );
}

function OrdersTable({ orders }) {
  if (!orders.length)
    return <p className="text-sm text-zinc-400 px-1 py-4">No orders to plan for this hub.</p>;
  return (
    <div className="w-full overflow-x-auto border border-zinc-200 rounded-sm bg-white">
      <table className="w-full border-collapse" data-testid="orders-table">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr>
            <TH>Order Id</TH>
            <TH>Plan</TH>
            <TH>Toy</TH>
            <TH>Type</TH>
            <TH>Customer</TH>
            <TH>Pincode</TH>
            <TH>Status</TH>
            <TH>Expected Delivery</TH>
            <TH>Serviceable</TH>
            <TH>Tags</TH>
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => (
            <tr
              key={o.order_id + i}
              className={`transition-colors border-b border-zinc-100 last:border-0 ${
                o.is_overdue ? "bg-red-50/40 hover:bg-red-50/70" : "hover:bg-blue-50/40"
              }`}
              data-testid="order-row"
            >
              <TD mono>{o.order_id}</TD>
              <TD><OverdueBadge overdue={o.is_overdue} /></TD>
              <TD>{o.toy_name}</TD>
              <TD>{o.toy_type}</TD>
              <TD>{o.user_name || "—"}</TD>
              <TD mono>{o.pincode || "—"}</TD>
              <TD><StatusBadge status={o.order_status} /></TD>
              <TD mono>{fmtDateTime(o.expected_delivery_date)}</TD>
              <TD><ServiceBadge status={o.serveable_status} /></TD>
              <TD>
                <span className="text-xs text-zinc-500 max-w-[220px] inline-block truncate align-bottom">
                  {o.tags || "—"}
                </span>
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReturnsTable({ returns }) {
  if (!returns.length)
    return <p className="text-sm text-zinc-400 px-1 py-4">No returns to pick up for this hub.</p>;
  return (
    <div className="w-full overflow-x-auto border border-zinc-200 rounded-sm bg-white">
      <table className="w-full border-collapse" data-testid="returns-table">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr>
            <TH>Return Id</TH>
            <TH>Plan</TH>
            <TH>Order Id</TH>
            <TH>Product</TH>
            <TH>Customer</TH>
            <TH>Pincode</TH>
            <TH>Owner → Receiving</TH>
            <TH>Requested At</TH>
            <TH>Condition</TH>
          </tr>
        </thead>
        <tbody>
          {returns.map((r, i) => (
            <tr
              key={r.return_order + i}
              className={`transition-colors border-b border-zinc-100 last:border-0 ${
                r.is_overdue ? "bg-red-50/40 hover:bg-red-50/70" : "hover:bg-amber-50/40"
              }`}
              data-testid="return-row"
            >
              <TD mono>{r.return_order}</TD>
              <TD><OverdueBadge overdue={r.is_overdue} /></TD>
              <TD mono>{r.order_id}</TD>
              <TD>{r.product_name}</TD>
              <TD>{r.user_name || "—"}</TD>
              <TD mono>{r.pincode || "—"}</TD>
              <TD>
                <span className="text-xs text-zinc-500">
                  {r.owner_library_name || "—"} → {r.receiving_library_name || "—"}
                </span>
              </TD>
              <TD>{fmtDateTime(r.return_created_at)}</TD>
              <TD>{r.toy_condition || "—"}</TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [planDate, setPlanDate] = useState(todayISO());
  const [syncMeta, setSyncMeta] = useState(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [showSync, setShowSync] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [plan, setPlan] = useState(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [activeHub, setActiveHub] = useState(null);
  const [view, setView] = useState("plan");

  const downloadFile = (url, name) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/sync/status`);
      setSyncMeta(data);
      setSheetUrl(data.sheet_url || "");
      if (!data.synced) setShowSync(true);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const loadPlan = useCallback(async (date) => {
    setLoadingPlan(true);
    try {
      const { data } = await axios.get(`${API}/plan`, { params: { date } });
      setPlan(data);
      setActiveHub((prev) => {
        if (prev && data.hubs.some((h) => h.hub_name === prev)) return prev;
        return data.hubs.length ? data.hubs[0].hub_name : null;
      });
    } catch (e) {
      console.error(e);
      toast.error("Could not load plan");
    } finally {
      setLoadingPlan(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (syncMeta?.synced) loadPlan(planDate);
  }, [planDate, syncMeta?.synced, syncMeta?.synced_at, loadPlan]);

  const doSync = async () => {
    setSyncing(true);
    toast.info("Syncing data from Google Sheet… this can take up to a minute.");
    try {
      const { data } = await axios.post(`${API}/sync`, { sheet_url: sheetUrl || undefined });
      const meta = { ...data, synced: true };
      setSyncMeta(meta);
      setShowSync(false);
      toast.success(
        `Synced ${data.orders_count} orders & ${data.returns_count} pending returns.`
      );
      await loadPlan(planDate);
    } catch (e) {
      console.error(e);
      toast.error(e?.response?.data?.detail || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const downloadAll = () =>
    downloadFile(
      `${API}/plan/export?date=${planDate}`,
      `last_mile_plan_${planDate}.xlsx`
    );

  const downloadHub = (hub) =>
    downloadFile(
      `${API}/plan/export/hub?hub=${encodeURIComponent(hub)}&date=${planDate}`,
      `plan_${hub}_${planDate}.xlsx`
    );

  const current = plan?.hubs?.find((h) => h.hub_name === activeHub) || null;

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      <Toaster position="top-right" richColors />

      {/* Header */}
      <header className="bg-[#0F172A] text-white border-b border-zinc-800 sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-sm bg-blue-600 flex items-center justify-center">
              <Truck size={22} weight="bold" />
            </div>
            <div>
              <h1 className="font-heading text-lg sm:text-xl font-extrabold tracking-tight leading-none">
                Last Mile Planner
              </h1>
              <p className="text-[11px] text-zinc-400 tracking-wide uppercase">
                Hub-wise Daily Dispatch & Returns
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              {syncMeta?.synced ? (
                <>
                  <span className="text-xs text-zinc-300 flex items-center gap-1">
                    <CheckCircle size={14} weight="fill" className="text-emerald-400" />
                    Last synced {fmtDateTime(syncMeta.synced_at)}
                  </span>
                  <span className="text-[11px] text-zinc-500 font-mono">
                    {syncMeta.orders_count} orders · {syncMeta.returns_count} returns
                  </span>
                </>
              ) : (
                <span className="text-xs text-amber-400 flex items-center gap-1">
                  <Warning size={14} weight="fill" /> Not synced yet
                </span>
              )}
            </div>
            <button
              onClick={() => setShowSync((s) => !s)}
              className="inline-flex items-center gap-2 bg-white text-zinc-900 hover:bg-zinc-100 rounded-sm px-3 py-2 text-sm font-medium transition-colors"
              data-testid="toggle-sync-btn"
            >
              <CloudArrowDown size={16} weight="bold" /> Data Source
            </button>
            <button
              onClick={doSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-sm px-4 py-2 text-sm font-medium transition-colors"
              data-testid="sync-btn"
            >
              {syncing ? (
                <Spinner size={16} className="animate-spin" weight="bold" />
              ) : (
                <ArrowsClockwise size={16} weight="bold" />
              )}
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
          </div>
        </div>

        {showSync && (
          <div className="border-t border-zinc-800 bg-[#111827]">
            <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <label className="text-xs text-zinc-400 uppercase tracking-wider whitespace-nowrap">
                Google Sheet URL
              </label>
              <input
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-sm px-3 py-2 text-sm text-zinc-100 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="sheet-url-input"
              />
              <span className="text-[11px] text-zinc-500">
                Sheet must be shared as "Anyone with the link can view".
              </span>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6">
        {syncMeta?.synced && (
          <div className="flex items-center gap-1 border-b border-zinc-200">
            <TabButton active={view === "plan"} onClick={() => setView("plan")} testid="tab-plan">
              Last Mile Plan
            </TabButton>
            <TabButton active={view === "confirm"} onClick={() => setView("confirm")} testid="tab-confirm">
              Order Confirmation
            </TabButton>
            <TabButton active={view === "returns"} onClick={() => setView("returns")} testid="tab-returns">
              Confirm via Returns
            </TabButton>
          </div>
        )}

        {syncMeta?.synced && view === "confirm" && (
          <ConfirmationView downloadFile={downloadFile} />
        )}

        {syncMeta?.synced && view === "returns" && (
          <ReturnConfirmationView downloadFile={downloadFile} />
        )}

        {/* Controls */}
        {syncMeta?.synced && view === "plan" && (
        <div className="bg-white border border-zinc-200 rounded-sm shadow-sm p-4 sm:p-5 flex flex-col lg:flex-row lg:items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
              Plan Date
            </label>
            <div className="flex items-center gap-2 border border-zinc-300 rounded-sm px-3 py-2 bg-white">
              <CalendarBlank size={18} className="text-zinc-500" />
              <input
                type="date"
                value={planDate}
                onChange={(e) => setPlanDate(e.target.value)}
                className="text-sm font-mono text-zinc-900 focus:outline-none bg-transparent"
                data-testid="plan-date-input"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3 lg:gap-6">
            <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-blue-50 border border-blue-200">
              <Package size={18} className="text-blue-600" weight="bold" />
              <div className="leading-tight">
                <p className="text-[11px] text-blue-700 uppercase tracking-wider font-semibold">
                  Deliveries due by (within +2 days) + overdue
                </p>
                <p className="text-sm font-mono text-blue-900">
                  {fmtDate(plan?.target_delivery_date)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-amber-50 border border-amber-200">
              <ArrowUUpLeft size={18} className="text-amber-600" weight="bold" />
              <div className="leading-tight">
                <p className="text-[11px] text-amber-700 uppercase tracking-wider font-semibold">
                  Returns requested by (−2 days) + overdue
                </p>
                <p className="text-sm font-mono text-amber-900">
                  {fmtDate(plan?.return_request_date)}
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={downloadAll}
            disabled={!plan || !plan.hubs.length}
            className="lg:ml-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-sm px-4 py-2.5 text-sm font-medium transition-colors"
            data-testid="download-all-btn"
          >
            <DownloadSimple size={18} weight="bold" /> Download All Hubs (Excel)
          </button>
        </div>
        )}

        {/* Not synced prompt */}
        {!syncMeta?.synced && !syncing && (
          <div className="bg-white border border-dashed border-zinc-300 rounded-sm p-10 text-center flex flex-col items-center gap-3">
            <CloudArrowDown size={40} className="text-zinc-400" />
            <p className="text-zinc-600 max-w-md">
              No data loaded yet. Click <strong>Sync Now</strong> to pull the latest orders and
              returns from your Google Sheet.
            </p>
            <button
              onClick={doSync}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white rounded-sm px-4 py-2 text-sm font-medium"
              data-testid="empty-sync-btn"
            >
              <ArrowsClockwise size={16} weight="bold" /> Sync Now
            </button>
          </div>
        )}

        {/* KPIs */}
        {syncMeta?.synced && view === "plan" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Kpi
              icon={<Buildings size={40} weight="duotone" />}
              label="Hubs to Plan"
              value={plan?.totals?.hubs ?? "—"}
              accent="bg-zinc-900"
            />
            <Kpi
              icon={<Package size={40} weight="duotone" />}
              label="Orders to Deliver"
              value={plan?.totals?.orders ?? "—"}
              accent="bg-blue-600"
              sub={plan?.totals?.orders_overdue ? `${plan.totals.orders_overdue} overdue` : null}
            />
            <Kpi
              icon={<ArrowUUpLeft size={40} weight="duotone" />}
              label="Returns to Pick Up"
              value={plan?.totals?.returns ?? "—"}
              accent="bg-amber-600"
              sub={plan?.totals?.returns_overdue ? `${plan.totals.returns_overdue} overdue` : null}
            />
          </div>
        )}

        {/* Plan grid */}
        {syncMeta?.synced && view === "plan" && (
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            {/* Hub nav */}
            <aside className="xl:col-span-3 2xl:col-span-2">
              <div className="bg-white border border-zinc-200 rounded-sm shadow-sm">
                <div className="px-4 py-3 border-b border-zinc-200">
                  <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
                    Hubs
                  </span>
                </div>
                <div className="flex flex-row xl:flex-col gap-1 overflow-x-auto xl:overflow-visible p-2">
                  {plan?.hubs?.length ? (
                    plan.hubs.map((h) => {
                      const active = h.hub_name === activeHub;
                      return (
                        <button
                          key={h.hub_name}
                          onClick={() => setActiveHub(h.hub_name)}
                          data-testid={`hub-tab-${h.hub_name}`}
                          className={`px-3 py-2.5 text-left text-sm rounded-sm border-l-4 transition-all whitespace-nowrap flex-shrink-0 xl:flex-shrink-auto flex justify-between items-center gap-3 ${
                            active
                              ? "bg-zinc-100 text-zinc-900 border-zinc-900 font-semibold"
                              : "text-zinc-600 hover:bg-zinc-50 border-transparent"
                          }`}
                        >
                          <span className="truncate">{h.hub_name}</span>
                          <span className="flex items-center gap-1 text-[11px] font-mono">
                            <span className="text-blue-600">{h.order_count}</span>
                            <span className="text-zinc-300">/</span>
                            <span className="text-amber-600">{h.return_count}</span>
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="text-sm text-zinc-400 p-3">No hubs for this date.</p>
                  )}
                </div>
              </div>
            </aside>

            {/* Hub content */}
            <section className="xl:col-span-9 2xl:col-span-10 flex flex-col gap-6">
              {loadingPlan ? (
                <div className="bg-white border border-zinc-200 rounded-sm p-16 flex items-center justify-center text-zinc-400 gap-2">
                  <Spinner size={20} className="animate-spin" /> Loading plan…
                </div>
              ) : current ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 bg-white border border-zinc-200 rounded-sm shadow-sm px-5 py-4">
                    <Buildings size={26} weight="duotone" className="text-zinc-700" />
                    <div>
                      <h2 className="font-heading text-xl font-bold tracking-tight leading-none">
                        {current.hub_name}
                      </h2>
                      {current.hub_code && (
                        <p className="text-xs text-zinc-500 font-mono mt-0.5">
                          {current.hub_code}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-2">
                      <span className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                        <Package size={14} weight="bold" /> {current.order_count} orders
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        <ArrowUUpLeft size={14} weight="bold" /> {current.return_count} returns
                      </span>
                    </div>
                    <button
                      onClick={() => downloadHub(current.hub_name)}
                      className="ml-auto inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 rounded-sm px-3 py-2 text-sm font-medium transition-colors"
                      data-testid="download-hub-btn"
                    >
                      <DownloadSimple size={16} weight="bold" /> Download Hub
                    </button>
                  </div>

                  {/* Orders */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-sm bg-blue-600" />
                      <h3 className="font-heading text-base font-bold tracking-tight text-zinc-900">
                        Orders to Deliver
                      </h3>
                      <span className="text-sm text-zinc-400 font-mono">
                        ({current.order_count})
                      </span>
                    </div>
                    <OrdersTable orders={current.orders} />
                  </div>

                  {/* Returns */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-sm bg-amber-600" />
                      <h3 className="font-heading text-base font-bold tracking-tight text-zinc-900">
                        Returns to Pick Up
                      </h3>
                      <span className="text-sm text-zinc-400 font-mono">
                        ({current.return_count})
                      </span>
                    </div>
                    <ReturnsTable returns={current.returns} />
                  </div>
                </>
              ) : (
                <div className="bg-white border border-dashed border-zinc-300 rounded-sm p-16 text-center text-zinc-500 flex flex-col items-center gap-2">
                  <CalendarBlank size={36} className="text-zinc-300" />
                  <p>
                    Nothing to plan for <strong>{fmtDate(planDate)}</strong>.
                  </p>
                  <p className="text-sm text-zinc-400">
                    Orders delivering on {fmtDate(plan?.target_delivery_date)} and returns
                    requested on {fmtDate(plan?.return_request_date)} will appear here.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
