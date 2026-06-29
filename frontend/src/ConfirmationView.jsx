import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import {
  Buildings,
  DownloadSimple,
  CheckCircle,
  Spinner,
  PaperPlaneTilt,
  CalendarBlank,
} from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const TH = ({ children }) => (
  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-zinc-600 uppercase tracking-wider whitespace-nowrap">
    {children}
  </th>
);
const TD = ({ children, mono }) => (
  <td className={`px-3 py-2.5 text-sm align-top ${mono ? "font-mono text-zinc-900 whitespace-nowrap" : "text-zinc-700"}`}>
    {children}
  </td>
);

function ReadyTable({ orders }) {
  if (!orders.length)
    return <p className="text-sm text-zinc-400 px-1 py-4">No orders ready to confirm for this hub.</p>;
  return (
    <div className="w-full overflow-x-auto border border-zinc-200 rounded-sm bg-white">
      <table className="w-full border-collapse" data-testid="ready-table">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr>
            <TH>Order Id</TH>
            <TH>Product</TH>
            <TH>Customer</TH>
            <TH>Order Type</TH>
            <TH>Available Inv.</TH>
            <TH>Expected Delivery</TH>
            <TH>Current Status</TH>
          </tr>
        </thead>
        <tbody>
          {orders.map((o, i) => (
            <tr key={o.order_id + i} className="hover:bg-emerald-50/40 transition-colors border-b border-zinc-100 last:border-0" data-testid="ready-row">
              <TD mono>{o.order_id}</TD>
              <TD>{o.product_name}</TD>
              <TD>{o.user_name || "—"}</TD>
              <TD><span className="text-xs text-zinc-500">{o.order_type || "—"}</span></TD>
              <TD mono>{o.available_inventory}</TD>
              <TD mono>{fmtDate(o.expected_delivery_date)}</TD>
              <TD>
                <span className="inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium border bg-zinc-100 text-zinc-700 border-zinc-200">
                  {o.order_status}
                </span>
              </TD>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ icon, label, value, accent }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-sm p-5 flex items-center gap-4 shadow-sm relative overflow-hidden" data-testid={`conf-kpi-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <div className={`absolute left-0 top-0 h-full w-1 ${accent}`} />
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">{label}</span>
        <span className="text-3xl sm:text-4xl font-semibold text-zinc-900 font-mono tracking-tighter">{value}</span>
      </div>
      <div className="ml-auto text-zinc-300">{icon}</div>
    </div>
  );
}

export default function ConfirmationView({ downloadFile }) {
  const [conf, setConf] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeHub, setActiveHub] = useState(null);
  const [planDate, setPlanDate] = useState(todayISO());

  const load = useCallback(async (date) => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/confirmation`, { params: { date } });
      setConf(data);
      setActiveHub((prev) => {
        if (prev && data.hubs.some((h) => h.hub_name === prev)) return prev;
        return data.hubs.length ? data.hubs[0].hub_name : null;
      });
    } catch (e) {
      console.error(e);
      toast.error("Could not load confirmation plan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(planDate);
  }, [load, planDate]);

  const current = conf?.hubs?.find((h) => h.hub_name === activeHub) || null;

  const downloadAll = () =>
    downloadFile(`${API}/confirmation/export?date=${planDate}`, "order_confirmation_plan.xlsx");
  const downloadHub = (hub) =>
    downloadFile(`${API}/confirmation/export/hub?hub=${encodeURIComponent(hub)}&date=${planDate}`, `confirmation_${hub}.xlsx`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold tracking-tight text-zinc-900">Order Confirmation</h2>
          <p className="text-sm text-zinc-500">
            Fully serviceable PLACED orders — stock is available, move them PLACED → CONFIRMED and send to the warehouse.
          </p>
        </div>
        <button
          onClick={downloadAll}
          disabled={!conf || !conf.hubs.length}
          className="sm:ml-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-sm px-4 py-2.5 text-sm font-medium transition-colors"
          data-testid="conf-download-all-btn"
        >
          <DownloadSimple size={18} weight="bold" /> Download All Hubs (Excel)
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm shadow-sm p-4 sm:p-5 flex flex-col sm:flex-row sm:items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Plan Date</label>
          <div className="flex items-center gap-2 border border-zinc-300 rounded-sm px-3 py-2 bg-white">
            <CalendarBlank size={18} className="text-zinc-500" />
            <input
              type="date"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
              className="text-sm font-mono text-zinc-900 focus:outline-none bg-transparent"
              data-testid="conf-plan-date-input"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-emerald-50 border border-emerald-200">
          <PaperPlaneTilt size={18} className="text-emerald-600" weight="bold" />
          <div className="leading-tight">
            <p className="text-[11px] text-emerald-700 uppercase tracking-wider font-semibold">
              Review orders delivering by (within +2 days)
            </p>
            <p className="text-sm font-mono text-emerald-900">{fmtDate(conf?.target_delivery_date)}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Kpi icon={<Buildings size={40} weight="duotone" />} label="Warehouses" value={conf?.totals?.hubs ?? "—"} accent="bg-zinc-900" />
        <Kpi icon={<PaperPlaneTilt size={40} weight="duotone" />} label="Ready to Confirm" value={conf?.totals?.ready_to_confirm ?? "—"} accent="bg-emerald-600" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <aside className="xl:col-span-3 2xl:col-span-2">
          <div className="bg-white border border-zinc-200 rounded-sm shadow-sm">
            <div className="px-4 py-3 border-b border-zinc-200">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Warehouses</span>
            </div>
            <div className="flex flex-row xl:flex-col gap-1 overflow-x-auto xl:overflow-visible p-2">
              {conf?.hubs?.length ? (
                conf.hubs.map((h) => {
                  const active = h.hub_name === activeHub;
                  return (
                    <button
                      key={h.hub_name}
                      onClick={() => setActiveHub(h.hub_name)}
                      data-testid={`conf-hub-tab-${h.hub_name}`}
                      className={`px-3 py-2.5 text-left text-sm rounded-sm border-l-4 transition-all whitespace-nowrap flex-shrink-0 xl:flex-shrink-auto flex justify-between items-center gap-3 ${
                        active ? "bg-zinc-100 text-zinc-900 border-zinc-900 font-semibold" : "text-zinc-600 hover:bg-zinc-50 border-transparent"
                      }`}
                    >
                      <span className="truncate">{h.hub_name}</span>
                      <span className="text-[11px] font-mono text-emerald-600">{h.ready_count}</span>
                    </button>
                  );
                })
              ) : (
                <p className="text-sm text-zinc-400 p-3">No data.</p>
              )}
            </div>
          </div>
        </aside>

        <section className="xl:col-span-9 2xl:col-span-10 flex flex-col gap-6">
          {loading ? (
            <div className="bg-white border border-zinc-200 rounded-sm p-16 flex items-center justify-center text-zinc-400 gap-2">
              <Spinner size={20} className="animate-spin" /> Loading confirmation plan…
            </div>
          ) : current ? (
            <>
              <div className="flex flex-wrap items-center gap-3 bg-white border border-zinc-200 rounded-sm shadow-sm px-5 py-4">
                <Buildings size={26} weight="duotone" className="text-zinc-700" />
                <div>
                  <h2 className="font-heading text-xl font-bold tracking-tight leading-none">{current.hub_name}</h2>
                  {current.hub_code && <p className="text-xs text-zinc-500 font-mono mt-0.5">{current.hub_code}</p>}
                </div>
                <span className="ml-2 inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <PaperPlaneTilt size={14} weight="bold" /> {current.ready_count} ready
                </span>
                <button
                  onClick={() => downloadHub(current.hub_name)}
                  className="ml-auto inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 rounded-sm px-3 py-2 text-sm font-medium transition-colors"
                  data-testid="conf-download-hub-btn"
                >
                  <DownloadSimple size={16} weight="bold" /> Download Hub
                </button>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle size={18} weight="fill" className="text-emerald-600" />
                  <h3 className="font-heading text-base font-bold tracking-tight text-zinc-900">
                    Ready to Confirm — Send to Warehouse
                  </h3>
                  <span className="text-sm text-zinc-400 font-mono">({current.ready_count})</span>
                </div>
                <ReadyTable orders={current.ready_to_confirm} />
              </div>
            </>
          ) : (
            <div className="bg-white border border-dashed border-zinc-300 rounded-sm p-16 text-center text-zinc-500">
              No confirmation data available. Try syncing the latest sheet.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
