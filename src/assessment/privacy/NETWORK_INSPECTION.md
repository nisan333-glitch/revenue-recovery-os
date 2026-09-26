# Privacy — Manual Network Inspection Procedure

> ## Scope correction (EP-19) — read this before using the procedure below
>
> **This document once said the whole assessment workflow runs entirely in the browser. That is no
> longer true, and was not true from EP-13 onward.** It is corrected here rather than deleted,
> because the narrower claim it makes is still real, still enforced, and still worth verifying.
>
> What is **still** true: the **assessment core** (`src/assessment/*`) makes no network calls at
> all. It imports no HTTP client, and `npm run check:purity` fails the build if it ever does. The
> browser-side figure on the *local preview* screen is genuinely computed on the customer's machine.
>
> What is **no longer** true: the **pilot workflow** uploads the CSV. Server-side contract
> validation is authoritative (EP-13), and a governed execution runs on the server (EP-16). A
> **pseudonymised, customer-derived projection** of the *accepted* rows — first-appearance ordinals
> in place of identifiers, but real dates and real amounts — is persisted server-side under an
> explicit retention policy (EP-16/EP-17). Exact dates and amounts **can permit linkage**; this
> states the exposure, not a measured re-identification rate, and pseudonymisation is not
> anonymisation. Rejected rows are never stored.
>
> So: do **not** tell a customer their file never leaves their machine. Tell them the file is
> uploaded, what is kept, and for how long. The procedure below verifies the assessment core's
> isolation — a narrower and still-useful claim — not a whole-product guarantee.

The **assessment core** processes a customer's CSV **entirely in the browser**. No customer-derived
data may leave that core. This is enforced by design (it calls no egress API) and observed by the
automated tripwire (`privacyMonitor.ts`, `privacyMonitor.test.ts`). Automated tests are necessary
but **not sufficient** — before any real customer CSV is used, complete this manual inspection as
well.

> The privacy monitor is **observability only**: it records egress attempts and delegates to the
> original API unchanged. It never blocks a request, so it cannot create a false sense of safety —
> a clean run means the code genuinely made no request, not that a request was suppressed.

## What counts as customer-derived data

The raw CSV, the file name, parsed rows, entity identifiers, dates, amounts, currencies, derived
cohorts, the Assessment Policy, calculation outputs, the source fingerprint, and any export.

## Egress vectors to verify are silent

`fetch` · `XMLHttpRequest` · `navigator.sendBeacon` · `WebSocket` · `EventSource` · HTML form
submission.

## Procedure (repeat on every release and before each Design Partner session)

1. **Load the app**, then open DevTools → **Network** tab. Enable **"Preserve log"**. Clear the log.
2. **Go offline after load:** DevTools → Network → throttling → **Offline** (or disconnect the
   network). The **local preview** path must complete fully while offline — pick a CSV, review data
   quality / cohort, view the local preview, and export the summary. If any of those steps fails
   offline, it depends on the network — investigate before proceeding.

   The **governed** path is expected to fail offline, and that failure is the correct behaviour: it
   requires the server. It must surface as an error, never as a result. If going offline produces a
   figure on the governed-execution screen, stop — something is presenting a browser-computed number
   as a server execution, which is the most serious defect this procedure can find.
3. **Watch the Network log** throughout the whole workflow. After the initial static assets
   (HTML/JS/CSS/font) finish loading, there must be **zero** further requests — no `fetch`, no
   `xhr`, no `beacon`/`ping`, no `ws`/`wss`, no `eventsource`, no form navigations. Filter by `Fetch/XHR`,
   `WS`, and `Other` to confirm each is empty.
4. **Confirm request contents (belt and suspenders):** for every request that appears, confirm it is
   a static app asset served from the app's own origin, and that neither its URL nor its body
   contains any customer-derived value (open the request → Payload/Request tabs). No app-shell asset
   should carry customer data.
5. **Console/log check:** DevTools → **Console**. Run the full workflow and confirm no raw
   customer value (identifiers, amounts, the CSV) is printed. Errors must be sanitized.
6. **Third-party check:** confirm no analytics/telemetry/error-reporting/CDN/remote-AI request
   appears in the Network log. (The app ships with no such dependency — this verifies it stays that
   way.)

## Pass criteria

- The **local preview** path completes **offline**.
- Across that path, after static assets, the Network log shows **zero** requests in Fetch/XHR, WS and
  Other.
- On the **governed** path, the only requests are to the app's **own origin** under `/api/...`. No
  third-party host appears, ever.
- No customer-derived value appears in any Console output, and none appears in a request URL. The
  CSV **does** appear in the body of the intake and schedule calls — by design, to the app's own
  server — and that is the difference this document now exists to keep straight.
- The automated privacy test (`privacyMonitor.test.ts`) passes: the assessment core emits **zero**
  egress attempts, and the tripwire is proven to detect all six vectors.

What may be stated after both the automated tests and this inspection pass, in plain language:

> The figure on the preview screen is computed on your machine. To get a governed result, the file is
> uploaded to our server, which validates it and runs the assessment. We keep a pseudonymised copy of
> the rows that passed validation — identifiers replaced, dates and amounts intact — under a stated
> retention period, and we keep no copy of the rows that failed.

What may **not** be stated: that the file never leaves the machine, that nothing is uploaded, that
the retained projection is anonymous, or any numeric re-identification risk.
