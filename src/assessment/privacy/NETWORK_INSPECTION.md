# Privacy — Manual Network Inspection Procedure

The **Revenue Opportunity Assessment** processes a customer's CSV **entirely in the browser**. No
customer-derived data may leave the browser. This is enforced by design (the assessment core calls
no egress API) and observed by the automated tripwire (`privacyMonitor.ts`,
`privacyMonitor.test.ts`). Automated tests are necessary but **not sufficient** — before any real
customer CSV is used, complete this manual inspection as well.

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
   network). The assessment workflow must complete fully while offline — upload a CSV, review data
   quality / cohort, view the Observed result, and export the summary. If any step fails offline, it
   depends on the network — investigate before proceeding.
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

- The full assessment workflow completes **offline**.
- After static assets, the Network log shows **zero** requests across Fetch/XHR, WS, and Other.
- No customer-derived value appears in any request URL/body or in the Console.
- The automated privacy test (`privacyMonitor.test.ts`) passes: the assessment emits **zero** egress
  attempts, and the tripwire is proven to detect all six vectors.

Only after **both** the automated tests and this manual inspection pass may the product state, in
plain language, that a customer's data never leaves their browser.
