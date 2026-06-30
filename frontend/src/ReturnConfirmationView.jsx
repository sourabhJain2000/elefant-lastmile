import { useMemo } from "react";
import { DownloadSimple, Spinner, ArrowUUpLeft, ListChecks } from "@phosphor-icons/react";
import { useData } from "@/lib/DataContext";
import { buildReturnConfirmation } from "@/lib/plans";
import { exportReturnConfirmation } from "@/lib/excel";

function ReturnStatusBadge({ status }) {
  const s = (status || "").toUpperCase();
  let cls = "bg-blue-50 text-blue-700 border-blue-200";
  if (s === "RETURNED") cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
  else if (s === "ARRIVED") cls = "bg-violet-50 text-violet-700 border-violet-200";
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

export default function ReturnConfirmationView() {
  const { store } = useData();
  const data = useMemo(() => buildReturnConfirmation(store), [store]);
  const loading = false;

  const orders = data?.orders || [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h2 className="font-heading text-lg font-bold tracking-tight text-zinc-900">Confirm via Returns</h2>
          <p className="text-sm text-zinc-500 max-w-2xl">
            Not-serviceable PLACED orders matched to an incoming return (<strong>PICKED_UP</strong>, <strong>RETURNED</strong> or <strong>ARRIVED</strong>)
            of the same toy at that warehouse. Limited return quantity is allocated to orders by earliest scheduled delivery date, then order number.
          </p>
        </div>
        <button
          onClick={() => exportReturnConfirmation(data)}
          disabled={!orders.length}
          className="sm:ml-auto inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-sm px-4 py-2.5 text-sm font-medium transition-colors"
          data-testid="rc-download-btn"
        >
          <DownloadSimple size={18} weight="bold" /> Download List (Excel)
        </button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-sm p-5 flex items-center gap-4 shadow-sm relative overflow-hidden max-w-sm" data-testid="rc-kpi-orders">
        <div className="absolute left-0 top-0 h-full w-1 bg-amber-600" />
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Orders Confirmable via Returns</span>
          <span className="text-3xl sm:text-4xl font-semibold text-zinc-900 font-mono tracking-tighter">
            {data?.totals?.orders ?? "—"}
          </span>
        </div>
        <ListChecks size={40} weight="duotone" className="ml-auto text-zinc-300" />
      </div>

      {loading ? (
        <div className="bg-white border border-zinc-200 rounded-sm p-16 flex items-center justify-center text-zinc-400 gap-2">
          <Spinner size={20} className="animate-spin" /> Loading list…
        </div>
      ) : orders.length ? (
        <div className="w-full overflow-x-auto border border-zinc-200 rounded-sm bg-white">
          <table className="w-full border-collapse" data-testid="rc-table">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <TH>Order Id</TH>
                <TH>Product</TH>
                <TH>Customer</TH>
                <TH>Warehouse</TH>
                <TH>Assigned Return</TH>
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={o.order_id + i} className="hover:bg-zinc-50 transition-colors border-b border-zinc-100 last:border-0" data-testid="rc-row">
                  <TD mono>{o.order_id}</TD>
                  <TD>{o.product_name}</TD>
                  <TD>{o.user_name || "—"}</TD>
                  <TD>
                    <span className="text-xs text-zinc-600">{o.library_name}</span>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1.5 max-w-[520px]">
                      {(o.matching_returns || []).map((m, j) => (
                        <span key={j} className="inline-flex items-center gap-1.5 rounded-sm border border-zinc-200 bg-white px-2 py-0.5">
                          <span className="font-mono text-xs text-zinc-800">{m.return_order}</span>
                          <ReturnStatusBadge status={m.return_status} />
                        </span>
                      ))}
                    </div>
                  </TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white border border-dashed border-zinc-300 rounded-sm p-16 text-center text-zinc-500 flex flex-col items-center gap-2">
          <ArrowUUpLeft size={36} className="text-zinc-300" />
          <p>No orders can be confirmed via returns right now.</p>
        </div>
      )}
    </div>
  );
}
