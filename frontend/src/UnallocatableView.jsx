import { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { DownloadSimple, Spinner, WarningOctagon, CalendarBlank, X } from "@phosphor-icons/react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

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
  <td className={`px-3 py-3 text-sm align-top ${mono ? "font-mono text-zinc-900 whitespace-nowrap" : "text-zinc-700"}`}>
    {children}
  </td>
);

export default function UnallocatableView({ downloadFile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState("");

  const load = useCallback(async (d) => {
    setLoading(true);
    try {
      const params = d ? { date: d } : {};
      const { data } = await axios.get(`${API}/unallocatable`, { params });
      setData(data);
    } catch (e) {
      console.error(e);
      toast.error("Could not load unallocatable orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [load, date]);

  const orders = data?.orders || [];
  const exportUrl = `${API}/unallocatable/export${date ? `?date=${date}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold tracking-tight text-zinc-900">Unallocatable Orders</h2>
          <p className="text-sm text-zinc-500 max-w-2xl">
            PLACED orders that cannot be fulfilled — no available stock and no incoming return at that warehouse.
            Use the date filter (future dates allowed) to plan ahead for upcoming shortfalls.
          </p>
        </div>
        <button
          onClick={() => downloadFile(exportUrl, "unallocatable_orders.xlsx")}
          disabled={!orders.length}
          className="sm:ml-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-sm px-4 py-2.5 text-sm font-medium transition-colors"
          data-testid="unalloc-download-btn"
        >
          <DownloadSimple size={18} weight="bold" /> Download List (Excel)
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm shadow-sm p-4 sm:p-5 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">
            Show orders delivering on or before
          </label>
          <div className="flex items-center gap-2 border border-zinc-300 rounded-sm px-3 py-2 bg-white">
            <CalendarBlank size={18} className="text-zinc-500" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="text-sm font-mono text-zinc-900 focus:outline-none bg-transparent"
              data-testid="unalloc-date-input"
            />
            {date && (
              <button onClick={() => setDate("")} className="text-zinc-400 hover:text-zinc-700" data-testid="unalloc-clear-date" title="Clear filter">
                <X size={16} weight="bold" />
              </button>
            )}
          </div>
          <span className="text-[11px] text-zinc-400">{date ? `Up to ${fmtDate(data?.target_delivery_date)} (+2 day buffer)` : "Showing all dates"}</span>
        </div>

        <div className="flex items-center gap-3 px-4 py-2 rounded-sm bg-red-50 border border-red-200">
          <WarningOctagon size={28} weight="duotone" className="text-red-600" />
          <div className="leading-tight">
            <p className="text-[11px] text-red-700 uppercase tracking-wider font-semibold">Orders with no inventory</p>
            <p className="text-2xl font-mono font-semibold text-red-900">{data?.totals?.orders ?? "—"}</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-white border border-zinc-200 rounded-sm p-16 flex items-center justify-center text-zinc-400 gap-2">
          <Spinner size={20} className="animate-spin" /> Loading…
        </div>
      ) : orders.length ? (
        <div className="w-full overflow-x-auto border border-zinc-200 rounded-sm bg-white">
          <table className="w-full border-collapse" data-testid="unalloc-table">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <TH>Order Id</TH>
                <TH>Product</TH>
                <TH>Customer</TH>
                <TH>Warehouse</TH>
                <TH>Available Inv.</TH>
                <TH>Expected Delivery</TH>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={o.order_id + i} className="hover:bg-red-50/30 transition-colors border-b border-zinc-100 last:border-0" data-testid="unalloc-row">
                  <TD mono>{o.order_id}</TD>
                  <TD>{o.product_name}</TD>
                  <TD>{o.user_name || "—"}</TD>
                  <TD><span className="text-xs text-zinc-600">{o.library_name}</span></TD>
                  <TD mono>{o.available_inventory}</TD>
                  <TD mono>{fmtDate(o.delivery_date)}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-dashed border-zinc-300 rounded-sm p-16 text-center text-zinc-500">
          No unallocatable orders for this filter.
        </div>
      )}
    </div>
  );
}
