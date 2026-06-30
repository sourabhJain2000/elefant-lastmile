import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { parseWorkbook, DEFAULT_SHEET_URL } from "@/lib/sheet";

const AUTO_SYNC_MS = 5 * 60 * 1000; // 5 minutes

const DataContext = createContext(null);

const emptyStore = { orders: [], returns: [], serviceable: [], libraries: [] };

export function DataProvider({ children }) {
  const [store, setStore] = useState(emptyStore);
  const [meta, setMeta] = useState(null);
  const [sheetUrl, setSheetUrl] = useState(DEFAULT_SHEET_URL);
  const [syncing, setSyncing] = useState(false);
  const sheetUrlRef = useRef(sheetUrl);
  sheetUrlRef.current = sheetUrl;

  const sync = useCallback(async ({ silent = false } = {}) => {
    const url = sheetUrlRef.current || DEFAULT_SHEET_URL;
    setSyncing(true);
    if (!silent) toast.info("Reading data from Google Sheet…");
    try {
      const data = await parseWorkbook(url);
      setStore(data);
      const newMeta = {
        synced: true,
        synced_at: new Date().toISOString(),
        sheet_url: url,
        orders_count: data.orders.length,
        returns_count: data.returns.length,
        serviceable_count: data.serviceable.length,
        libraries_count: data.libraries.length,
      };
      setMeta(newMeta);
      if (!silent)
        toast.success(`Loaded ${data.orders.length} orders & ${data.returns.length} pending returns.`);
      return newMeta;
    } catch (e) {
      console.error(e);
      if (!silent) toast.error(e?.message || "Could not read the Google Sheet.");
      else if (!meta) toast.error(e?.message || "Could not read the Google Sheet.");
      throw e;
    } finally {
      setSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial load + auto-refresh every 5 minutes.
  useEffect(() => {
    sync({ silent: true }).catch(() => {});
    const id = setInterval(() => sync({ silent: true }).catch(() => {}), AUTO_SYNC_MS);
    return () => clearInterval(id);
  }, [sync]);

  return (
    <DataContext.Provider value={{ store, meta, sheetUrl, setSheetUrl, syncing, sync }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
