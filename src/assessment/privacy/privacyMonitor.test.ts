import { describe, it, expect } from "vitest";
import { installPrivacyMonitor, type MonitorTarget } from "./privacyMonitor";
import { assessCsv } from "../assess";
import { makePolicy } from "../policy";

// NOTE: a static source-scan (the assessment core references no egress API) is provided as grep
// evidence in the CP3 report and enforced by the manual NETWORK_INSPECTION.md procedure, rather than
// as a unit test — reading source files here would require @types/node in this browser project.

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("privacyMonitor — observability tripwire (detect + report, never block)", () => {
  it("detects all six egress vectors on a synthetic target and delegates to the originals", () => {
    const called: string[] = [];
    const target: MonitorTarget = {
      fetch: ((..._a: unknown[]) => { called.push("fetch"); return Promise.resolve("ok"); }) as any,
      XMLHttpRequest: class { open() { called.push("open"); } send() { called.push("send"); } } as any,
      navigator: { sendBeacon: (() => { called.push("beacon"); return true; }) as any },
      WebSocket: class { constructor(_url: string) { called.push("ws"); } } as any,
      EventSource: class { constructor(_url: string) { called.push("es"); } } as any,
      HTMLFormElement: class { action = "http://form.test/a"; submit() { called.push("submit"); } requestSubmit() { called.push("rsubmit"); } } as any,
    };

    const mon = installPrivacyMonitor(target);
    void (target.fetch as any)("http://a.test/x?token=SECRET");
    const xhr = new (target.XMLHttpRequest as any)();
    xhr.open("POST", "http://b.test/y");
    xhr.send("CUSTOMER_BODY");
    (target.navigator as any).sendBeacon("http://c.test/z", "DATA");
    new (target.WebSocket as any)("ws://d.test/s");
    new (target.EventSource as any)("http://e.test/e");
    const form = new (target.HTMLFormElement as any)();
    form.submit();
    form.requestSubmit();
    mon.restore();

    const apis = mon.attempts.map((a) => a.api);
    for (const api of ["fetch", "xhr.open", "xhr.send", "sendBeacon", "WebSocket", "EventSource", "form.submit", "form.requestSubmit"]) {
      expect(apis).toContain(api);
    }
    // Delegation preserved (behaviour unchanged): every underlying original still ran.
    expect(called).toEqual(expect.arrayContaining(["fetch", "open", "send", "beacon", "ws", "es", "submit", "rsubmit"]));
    // The monitor records ORIGIN only — never the path/query/body that could carry customer data.
    for (const a of mon.attempts) {
      expect(a.origin).not.toContain("SECRET");
      expect(a.origin).not.toContain("CUSTOMER_BODY");
    }
  });

  it("restore() fully reverts the patched references", () => {
    const origFetch = ((..._a: unknown[]) => Promise.resolve("x")) as any;
    const target: MonitorTarget = { fetch: origFetch };
    const mon = installPrivacyMonitor(target);
    expect(target.fetch).not.toBe(origFetch); // patched
    mon.restore();
    expect(target.fetch).toBe(origFetch); // restored
  });

  it("running a full assessment emits ZERO egress attempts", async () => {
    const csv =
      "entity_id,signed_at,activation_at,next_invoice_due_at,next_invoice_amount,currency\n" +
      "E1,2026-01-01,,2026-02-01,10000.00,USD\nE2,2026-01-01,2026-01-10,2026-02-01,5000.00,USD";
    const mon = installPrivacyMonitor(); // globalThis
    try {
      await assessCsv(csv, makePolicy({ stallThresholdDays: 30, asOf: "2026-03-01", currency: "USD" }), {
        createdAt: "2026-03-02T00:00:00.000Z",
      });
    } finally {
      mon.restore();
    }
    expect(mon.attempts).toEqual([]);
  });
});
