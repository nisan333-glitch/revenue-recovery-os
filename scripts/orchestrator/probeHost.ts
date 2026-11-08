// The one credential-free reachability probe. I/O ONLY.
//
// It sends NO credential, so a refusal is a statement about the network and never about the key — and it
// goes through the same egress path as every other request, so a blocked host stays blocked. This module
// names what it is told; it does not route around anything.
import { LIVE_HOST, type ProbeResult } from "./liveReadiness.ts";

/**
 * Probe reachability with no credential attached.
 *
 * A 401 or 403 FROM THE PROVIDER means the network is reachable — the host answered, it simply refused an
 * unauthenticated request, which is the expected answer to a probe that deliberately carries no key. A
 * failure to connect at all is the network blocker. Distinguishing the two is the probe's entire job.
 */
export async function probeLiveHost(fetchImpl: typeof fetch = globalThis.fetch): Promise<ProbeResult> {
  try {
    const res = await fetchImpl(`https://${LIVE_HOST}/v1/models`, { method: "GET" });
    // Any HTTP answer at all means the host was reached.
    return { state: "REACHABLE", detail: `the host answered with HTTP ${res.status} to an unauthenticated probe` };
  } catch (err) {
    // THE CAUSE CHAIN, NOT THE TOP MESSAGE. Node's fetch reports `TypeError: fetch failed` and puts the
    // real reason in `cause` — so the first form of this probe classified a DNS refusal as
    // UNREACHABLE_OTHER on a message that said nothing. Printing what was actually observed, in full, is
    // the difference between a diagnosis and a shrug.
    const chain: string[] = [];
    let cursor: unknown = err;
    for (let depth = 0; depth < 6 && cursor instanceof Error; depth += 1) {
      const e = cursor as Error & { code?: string };
      chain.push(e.code ? `${e.name}(${e.code}): ${e.message}` : `${e.name}: ${e.message}`);
      cursor = (e as { cause?: unknown }).cause;
    }
    const detail = chain.join(" <- ").slice(0, 300) || "the connection did not complete";
    // A POLICY refusal is named as one, because its remedy is a policy change rather than a retry. Two
    // mechanisms produce it here and both are policy: the egress gateway answering 403 to a CONNECT, and
    // the environment not resolving the host at all. The caveat is stated rather than hidden: ENOTFOUND
    // for a host known to exist means THIS environment does not resolve it, and for a mistyped host it
    // would mean something else — so the observed code travels with the verdict.
    const policy = /\b403\b|proxy|tunnel|CONNECT|blocked|denied|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(detail);
    return {
      state: policy ? "BLOCKED_BY_POLICY" : "UNREACHABLE_OTHER",
      detail: `no credential was sent; ${detail}`,
    };
  }
}
