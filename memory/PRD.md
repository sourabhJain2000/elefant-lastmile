# Last Mile Planner — PRD

## Original Problem Statement
Plan last-mile orders daily, hub-wise, from a Google Sheet of pending orders & returns.
Priority logic:
- Orders: due by delivery date within +2 days (plus overdue).
- Returns (RETURN_REQUESTED): request date + 2 days (i.e. requested on or before plan_date −2), plus overdue.
- Hub-wise plans with per-hub Excel exports.

## Architecture (as of 2026-06-30) — FRONTEND-ONLY
Per user request, the app has **no backend and no database**. It is a pure React
(CRA + Tailwind + Shadcn) static frontend, deployable to Vercel.

- Data is read **directly in the browser** from the public Google Sheet using the
  full `.xlsx` export endpoint (`/export?format=xlsx`), which serves proper CORS
  headers. Parsed client-side with **ExcelJS**.
- All planning logic ported 1:1 from the old FastAPI backend into pure JS.
- All Excel exports generated client-side with ExcelJS.
- Auto-refresh every **5 minutes**; manual "Sync Now" button.

### Key frontend files
- `src/lib/sheet.js` — fetch + parse the workbook → `{orders, returns, serviceable, libraries}`.
- `src/lib/plans.js` — `buildPlan`, `buildConfirmation`, `buildReturnConfirmation`, `buildUnallocatable`, `buildPickupPlan` (pure functions).
- `src/lib/excel.js` — client-side `.xlsx` builders/downloads (ExcelJS).
- `src/lib/DataContext.jsx` — React context: holds parsed store + meta, `sync()`, 5-min auto-refresh.
- `src/App.js` — Last Mile Plan tab + shell.
- `src/ConfirmationView.jsx`, `ReturnConfirmationView.jsx`, `UnallocatableView.jsx`, `PickupPlanView.jsx` — the other 4 tabs.

> NOTE: `/app/backend` still exists but is **unused** (legacy). The frontend never calls it.

## 5 Views (tabs)
1. **Last Mile Plan** — hub-wise orders to deliver (+2d/overdue) and returns to pick up (−2d/overdue). Per-hub & all-hubs Excel.
2. **Order Confirmation** — Fully-serviceable PLACED orders ready to confirm, grouped by warehouse. Excel.
3. **Confirm via Returns** — Not/partially-serviceable orders matched 1:1 to incoming returns (PICKED_UP/RETURNED/ARRIVED) by earliest delivery date. Excel.
4. **Unallocatable Orders** — Not-serviceable orders with no stock and no incoming return supply; optional date filter. Excel.
5. **Return Pickup Plan** — Pending returns (RETURN_REQUESTED/READY_TO_PICKUP) needed to fulfil orders due in next 5 days. Excel.

## Data source
Google Sheet (default): `1Q7eGyhFSp-GuhqSMFGMvsE-XOQp8o5Hrm1Cwl4vw1YM`.
Tabs used: `Orders`, `Pending Returns`, `FullyPartially Serviceable`, `Librarys Master Sheet`.
Sheet must be shared "Anyone with the link can view". A different sheet URL can be entered via the Data Source panel.

## Status
- [x] Frontend-only migration complete (MongoDB & FastAPI dropped). Verified 2026-06-30.
- [x] All 5 tabs render from live browser-fetched data.
- [x] Client-side Excel exports verified (download events fire, valid filenames).
- [x] 5-minute auto-refresh.

## Backlog / P1-P2
- P2: Delete/clean up the unused `/app/backend` directory if desired.
- P2: Optional caching/last-updated indicator polish.
- P1 (future): If user wants a non-default sheet to persist, store last-used URL in localStorage.
