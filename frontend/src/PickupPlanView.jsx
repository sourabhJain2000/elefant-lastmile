import { useMemo, useState } from "react";
import { DownloadSimple, Spinner, Truck, CalendarBlank, HandArrowDown } from "@phosphor-icons/react";
import { useData } from "@/lib/DataContext";
import { buildPickupPlan } from "@/lib/plans";
import { exportPickupPlan } from "@/lib/excel";

const todayISO = () => new Date().toISOString().slice(0, 10);

const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

function PickupStatusBadge({ status }) {
  const s = (status || "").toUpperCase();
  const cls = s === "READY_TO_PICKUP" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-amber-50 text-amber-700 border-amber-200";
  return (
    <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[11px] font-medium border ${cls} whitespace-nowrap`}>
      {status}
    </span>
  );
}

const TH = ({ children }) => (
  <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-zinc-600 uppercase tracking-wider whitespace-nowrap">
    {children}
  </th>
);
const TD = ({ children, mono }) => (
  <td className={`px-3 py-3 text-sm align-top ${mono ? "font-mono text-zinc-900 whitespace-nowrap" : "text-zinc-700"}`}>
    {children}
  </td>
);

export default function PickupPlanView() {
  const { store } = useData();
  const [date, setDate] = useState(todayISO());

  const data = useMemo(() => buildPickupPlan(store, date), [store, date]);
  const loading = false;

  const rows = data?.pickups || [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold tracking-tight text-zinc-900">Return Pickup Plan</h2>
          <p className="text-sm text-zinc-500 max-w-2xl">
            Returns still to be picked up (<strong>RETURN_REQUESTED</strong> / <strong>READY_TO_PICKUP</strong>) that are needed to fulfil
            orders due in the next 5 days. Prioritised by the order's delivery date so urgent pickups happen first.
          </p>
        </div>
        <button
          onClick={() => exportPickupPlan(data)}
          disabled={!rows.length}
          className="sm:ml-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-sm px-4 py-2.5 text-sm font-medium transition-colors"
          data-testid="pickup-download-btn"
        >
          <DownloadSimple size={18} weight="bold" /> Download Plan (Excel)
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm shadow-sm p-4 sm:p-5 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Plan From Date</label>
          <div className="flex items-center gap-2 border border-zinc-300 rounded-sm px-3 py-2 bg-white">
            <CalendarBlank size={18} className="text-zinc-500" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-sm font-mono text-zinc-900 focus:outline-none bg-transparent"
              data-testid="pickup-date-input"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-sm bg-blue-50 border border-blue-200">
          <Truck size={18} className="text-blue-600" weight="bold" />
          <div className="leading-tight">
            <p className="text-[11px] text-blue-700 uppercase tracking-wider font-semibold">For orders delivering by (next 5 days)</p>
            <p className="text-sm font-mono text-blue-900">{fmtDate(data?.cutoff_date)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 rounded-sm bg-amber-50 border border-amber-200">
          <HandArrowDown size={28} weight="duotone" className="text-amber-600" />
          <div className="leading-tight">
            <p className="text-[11px] text-amber-700 uppercase tracking-wider font-semibold">Returns to pick up</p>
            <p className="text-2xl font-mono font-semibold text-amber-900">{data?.totals?.pickups ?? "—"}</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-zinc-200 rounded-sm p-16 flex items-center justify-center text-zinc-400 gap-2">
          <Spinner size={20} className="animate-spin" /> Loading…
        </div>
      ) : rows.length ? (
        <div className="w-full overflow-x-auto border border-zinc-200 rounded-sm bg-white">
          <table className="w-full border-collapse" data-testid="pickup-table">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <TH>Return Order</TH>
                <TH>Status</TH>
                <TH>Product</TH>
                <TH>Warehouse</TH>
                <TH>For Order</TH>
                <TH>Order Delivery Date</TH>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.return_order + i} className="hover:bg-amber-50/30 transition-colors border-b border-zinc-100 last:border-0" data-testid="pickup-row">
                  <TD mono>{p.return_order}</TD>
                  <TD><PickupStatusBadge status={p.return_status} /></TD>
                  <TD>{p.product_name}</TD>
                  <TD><span className="text-xs text-zinc-600">{p.library_name}</span></TD>
                  <TD mono>{p.for_order}</TD>
                  <TD mono>{fmtDate(p.order_delivery_date)}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-dashed border-zinc-300 rounded-sm p-16 text-center text-zinc-500">
          No pending pickups needed for orders in this window.
        </div>
      )}
    </div>
  );
}
