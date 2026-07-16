// Privacy Monitor — OBSERVABILITY ONLY.
//
// It detects and RECORDS any use of a data-egress API (fetch, XMLHttpRequest, navigator.sendBeacon,
// WebSocket, EventSource, form submission) and then DELEGATES to the original implementation
// unchanged. It never blocks, suppresses, rewrites, or alters the outcome of a call — it is a
// tripwire, not a firewall. Real privacy assurance = this automated tripwire (which must observe
// ZERO egress during an assessment) PLUS the manual network inspection in NETWORK_INSPECTION.md.
//
// The monitor itself is privacy-safe: it records only the API name and the request ORIGIN
// (scheme + host), never a URL path, query string, headers, or body — so it cannot itself leak
// customer-derived content.

export type NetworkApi =
  | "fetch"
  | "xhr.open"
  | "xhr.send"
  | "sendBeacon"
  | "WebSocket"
  | "EventSource"
  | "form.submit"
  | "form.requestSubmit";

export interface NetworkAttempt {
  readonly api: NetworkApi;
  readonly origin: string; // scheme+host only; never a path/query/body
}

export interface PrivacyMonitor {
  readonly attempts: NetworkAttempt[];
  /** Fully undoes every patch, restoring original references. */
  restore(): void;
}

/** A minimal, partial view of the globals we monitor — so a synthetic target can be passed in tests. */
export interface MonitorTarget {
  fetch?: unknown;
  XMLHttpRequest?: unknown;
  navigator?: { sendBeacon?: unknown } | unknown;
  WebSocket?: unknown;
  EventSource?: unknown;
  HTMLFormElement?: unknown;
}

function originOf(u: unknown): string {
  try {
    const raw = typeof u === "string" ? u : ((u as { url?: string })?.url ?? String(u));
    return new URL(raw, "http://local.invalid").origin;
  } catch {
    return "unknown";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export function installPrivacyMonitor(target: MonitorTarget = globalThis as unknown as MonitorTarget): PrivacyMonitor {
  const attempts: NetworkAttempt[] = [];
  const record = (api: NetworkApi, origin: string) => attempts.push({ api, origin });
  const restorers: Array<() => void> = [];
  const t = target as Any;

  // fetch
  if (typeof t.fetch === "function") {
    const orig = t.fetch;
    t.fetch = function (this: unknown, ...args: unknown[]) {
      record("fetch", originOf(args[0]));
      return orig.apply(this, args);
    };
    restorers.push(() => (t.fetch = orig));
  }

  // XMLHttpRequest.prototype.open / send
  if (typeof t.XMLHttpRequest === "function" && t.XMLHttpRequest.prototype) {
    const proto = t.XMLHttpRequest.prototype as Any;
    const origOpen = proto.open;
    const origSend = proto.send;
    if (typeof origOpen === "function") {
      proto.open = function (this: unknown, method: unknown, url: unknown, ...rest: unknown[]) {
        record("xhr.open", originOf(url));
        return origOpen.call(this, method, url, ...rest);
      };
      restorers.push(() => (proto.open = origOpen));
    }
    if (typeof origSend === "function") {
      proto.send = function (this: unknown, ...args: unknown[]) {
        record("xhr.send", "unknown");
        return origSend.apply(this, args);
      };
      restorers.push(() => (proto.send = origSend));
    }
  }

  // navigator.sendBeacon
  const nav = t.navigator as Any;
  if (nav && typeof nav.sendBeacon === "function") {
    const orig = nav.sendBeacon;
    nav.sendBeacon = function (this: unknown, url: unknown, ...rest: unknown[]) {
      record("sendBeacon", originOf(url));
      return orig.call(this, url, ...rest);
    };
    restorers.push(() => (nav.sendBeacon = orig));
  }

  // WebSocket / EventSource — newable constructors.
  for (const [key, api] of [["WebSocket", "WebSocket"], ["EventSource", "EventSource"]] as const) {
    if (typeof t[key] === "function") {
      const Orig = t[key];
      const Wrapped = function (this: unknown, ...args: unknown[]) {
        record(api as NetworkApi, originOf(args[0]));
        return new (Orig as Any)(...args);
      } as Any;
      Wrapped.prototype = Orig.prototype;
      t[key] = Wrapped;
      restorers.push(() => (t[key] = Orig));
    }
  }

  // Form submission
  if (typeof t.HTMLFormElement === "function" && t.HTMLFormElement.prototype) {
    const proto = t.HTMLFormElement.prototype as Any;
    for (const [method, api] of [["submit", "form.submit"], ["requestSubmit", "form.requestSubmit"]] as const) {
      const orig = proto[method];
      if (typeof orig === "function") {
        proto[method] = function (this: { action?: string }, ...args: unknown[]) {
          record(api as NetworkApi, originOf(this?.action));
          return orig.apply(this, args);
        };
        restorers.push(() => (proto[method] = orig));
      }
    }
  }

  return {
    attempts,
    restore() {
      while (restorers.length) restorers.pop()!();
    },
  };
}
