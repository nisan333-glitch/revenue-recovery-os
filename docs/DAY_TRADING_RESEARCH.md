# REVENIQ day-trading research — first integration slice

User request, 25 October 2026: daily trading, all eleven skills and reports inside the existing platform. This explicit demand extends the product scope for a personal research workspace. It does not change the revenue-recovery constitution or count trading returns in either recovery ledger.

The existing navigation now opens `DayTradingCenter`. This is a local report reader, not a broker or running strategy. It imports a single JSON report in memory, validates every closed trade against New York calendar dates, derives gross and net P&L, shows daily totals and the journal, and exports CSV and JSON. It does not persist uploads, make network requests, start background processes, send alerts or create orders. Leaving this module discards the report.

## Import contract

`schemaVersion: 1`, `strategy: ID-v1`, `evidence: synthetic | backtest | paper`, `runId`, `generatedAt` (ISO timestamp with explicit offset), `source`, `currency: USD`, positive `initialCapital`, and up to 5,000 `trades`. Maximum file size: 1,000,000 bytes. Use the screen's download button for a complete synthetic example. No live evidence status is accepted. Backtest and paper classifications are uploader claims, not independent verification.

Each closed, long-only trade has `id`, `symbol`, positive `quantity`, `entryTime`, `exitTime`, positive `entryPrice` and `exitPrice`, nonnegative `fees` and `slippage`, and `exitReason`. Gross = quantity × (exitPrice − entryPrice); net = gross − fees − slippage. Fees and slippage are total trade costs in USD, excluded from the two prices. An engine that already embeds costs in execution prices needs an adapter before import to avoid charging twice. No FX conversion, tax, open positions, portfolio drawdown or cash-flow-adjusted return is inferred. Do not use this contract for short trades.

CSV includes evidence, run identity, currency and per-trade costs. Formula-like free text is escaped. JSON export includes the original normalized report, computed totals and daily summaries. Reports remain independent of the recovery domain, proof chain and revenue metrics.

## Eleven skills and evidence

The screen lists the original names and the research statuses reported by Claude. Four conceptual counterparts (scanner, entry, exit, timemachine) were reimplemented in the research engine; risk is partial. Budget requires personal loss limits. Broker, news and alerts are disconnected; analyst and pelosi remain optional research context. The original skill package has not been installed or executed. Importing a report never changes these statuses.

Earlier independent verification covered 32 synthetic research-engine tests. Claude subsequently reported 54 tests and an intraday engine; that newer package still requires independent review and is not embedded here. Its data provider remains blocked. This PR tests the report/UI boundary only and makes no profitability claim.

Independent integration check: Claude's subsequent ID-v1 exporter produced a synthetic JSON report with 52 closed trades on 52 New York dates. The exact downloaded output passed this module's parser; gross minus fees minus slippage reconciled to net. These are invented market paths and do not support a performance claim. The exporter and its newer research-engine tests still need code review.

Validation on this branch: all 16 new boundary/UI tests passed; the full local suite passed 1,594 tests with 6 skipped. `npm run build` and `npm run check:purity` passed after generating the Prisma client. Cloud Browser could not reach the local Vite listener, so visual browser validation is not claimed. No Postgres-backed or broker execution test was run for this slice.

## Remaining implementation

1. Review Claude's intraday engine and exporter; reconcile its exact cost accounting to this contract.
2. Obtain licensed/identified historical intraday data and verify timestamp, sessions, early closes, corporate actions and gaps.
3. Import real backtests; compare with/without the simulation gate and include all trading/data costs. Then run forward paper sessions.
4. Add authenticated persistent runs, data provenance verification, job status and alerts using existing platform patterns; uploads currently stay in browser memory.
5. Establish personal risk limits and verify broker-supported stops, partial fills, idempotency and reconciliation. Live execution, account credentials and deposits are outside this slice.

Review branch: `codex/day-trading-reports`, based on `claude/pilot-reconciler-demo-v1` at `26182bf6121c4121b3634dadb0827d85727f6840`. No default-branch change, merge, deployment or permission change is included.
