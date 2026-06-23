# Last Mile Planner — PRD

## Original Problem Statement
Plan last-mile orders daily, hub-wise, from a Google Sheet (Orders, Pending Returns, Users Master, Library Master, FullyPartially Serviceable). Simple priority:
- Orders: plan based on delivery date 2 days in advance.
- Returns at stage "Return Requested": request date + 2 days.
- Plan created hub-wise; Excel sheet with individual hubs to be created.

## User Choices
1. Data source: live Google Sheet link (b)
2. Output: on-screen view + Excel download (c)
3. Exactly 2 days for both orders & returns
4. Internal open tool (no auth)
5. No design preference

## Architecture
- Backend: FastAPI + MongoDB. `POST /api/sync` downloads the sheet as XLSX, parses Orders (non-delivered), Pending Returns (RETURN_REQUESTED), serviceable map, and library master into Mongo. `GET /api/plan?date=` computes hub-wise plan. `GET /api/plan/export` (all hubs, sheet per hub) and `/api/plan/export/hub?hub=` (single hub) generate Excel via openpyxl.
- Frontend: React dashboard (control-tower aesthetic). Sync control, plan date picker, KPI cards, hub navigation list, per-hub Orders + Returns tables, download buttons.

## Planning Logic (exactly 2 days)
- target_delivery_date = plan_date + 2; orders with delivery_date == target.
- return_request_date = plan_date - 2; returns with request_date == that AND status RETURN_REQUESTED.
- Orders grouped by Library Name; returns grouped by Receiving Library Name (fallback Owner).
- Orders enriched with Serviceable Status (Fully/Partially) where available.

## Implemented (2026-06-23)
- Google Sheet sync (XLSX export), MongoDB caching.
- Hub-wise plan computation + on-screen dashboard.
- Excel export: all-hubs (Summary + per-hub sheets) and single-hub.
- Status/serviceable badges, KPIs, date picker, sync status display.

## Backlog / Next
- P1: Persisted scheduled auto-sync (cron) so data refreshes daily without manual click.
- P1: Use Users Master lat/long + Library lat/long for route optimization / distance grouping.
- P2: Filters (toy type, force/pre-order, serviceable only), search within hub.
- P2: Configurable "days in advance" instead of fixed 2.
- P2: Print-friendly per-hub view for delivery agents.
