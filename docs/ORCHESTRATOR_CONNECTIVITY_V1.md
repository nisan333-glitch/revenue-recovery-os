# Why the live OpenAI call cannot run yet — diagnosis from primary evidence

Four questions, answered on evidence gathered on 2026-11-08, not on inference. Nothing here was worked
around, and no security limit was bypassed.

---

## 1. Which permission is needed, exactly, and why

**One thing: an API credential for the host `api.openai.com`, saved as a *network secret* on the cloud
environment this session runs in.**

Why that specific form, rather than an environment variable:

* Saving a network secret for a host **also allows outbound HTTPS to that host**. One action closes both
  halves of the gap — the missing key and the blocked host — so no separate allowlist change is needed.
* The secret is injected into the request by the session's HTTPS proxy. The session never receives the
  value, so there is no path by which it could be printed, logged or committed.
* An environment **variable** would be the wrong mechanism and is explicitly refused for secrets: variable
  values are stored in plain text and are shown on the approval card. A key belongs in the secret channel.

Scope of what it grants: outbound HTTPS to `api.openai.com` from sessions on that environment. It grants no
repository permission, no push, no merge and no deploy.

## 2. Where the block comes from

**Not from OpenAI, and not from a missing key alone. It is the cloud environment's own network policy**, and
the refusal was captured directly:

```
$ curl https://api.openai.com/v1/models
curl: (56) CONNECT tunnel failed, response 403
```

The session's HTTPS proxy records the same event in its own status:

```json
{ "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "api.openai.com:443" }
```

And the environment it is enforcing:

| environment | network | allowed hosts | network secrets |
|---|---|---|---|
| `Default` (this session) | **limited** | **none** | **none** |
| `Default` (the other one) | limited | none | none |

Under *limited* access, only package registries and MCP-server hosts are reachable without being listed.
`api.openai.com` is on neither list, so the proxy's gateway answers **403 to the CONNECT** before any request
reaches OpenAI. The failure is therefore a **policy denial at our own edge** — it says nothing about the key,
the account or the provider.

## 3. Is another officially supported runtime available?

Checked, and the honest answer is **no better one is available right now** — three were examined:

1. **The other cloud environment.** Identical: limited, empty allowlist, no network secrets. It would change
   nothing. It is also not reachable from here — *"this kind of session cannot be moved to another
   environment while it runs."*
2. **A new cloud environment with the host allowed.** Supported and legitimate, and it still needs the same
   owner approval, plus the key. It is strictly more work than option 1 in §4 for the same result, so it is
   not recommended.
3. **Running on your own computer** — a Remote Control folder, or Claude Code in the desktop app or CLI,
   where the outbound network is yours and no gateway policy applies. Checked: **no folders are currently
   shared** (`folders: []`), so this route is not available without you setting it up first in the Claude
   desktop app under *Settings → Claude Code → Remote Control*.

There is no supported path that reaches the host without an owner decision, and that is the design rather
than an obstacle: an agent that could widen its own network reach would make the gate meaningless.

## 4. What is needed from you

**One of these two. The first is one action and is recommended.**

**Option 1 — save the key as a network secret (recommended).** It opens the host and supplies the credential
together.
*Where:* the cloud-environment menu in this session's title bar → **Edit** → **Network secrets** → add a
secret for host `api.openai.com`, header `Authorization`, prefix `Bearer`.
I may not do this for you, and after the declined request I will not ask again — it is yours to initiate.

**Option 2 — allow the host, then supply the key separately.**
*Where:* same menu → **Edit** → **Network access** → add `api.openai.com` under **Allowed domains**, leaving
*Allow package managers* ticked. Steps: <https://code.claude.com/docs/en/cloud-environments#network-access>.
This opens the host but leaves the credential unsolved, and a plaintext variable is the wrong home for a key
— so option 1 is better unless you have a reason to separate them.

**What I will do the moment either is in place:** run `npm run orchestrate -- run --prompt …` against the
**live** port and report the real provider response, its `providerRequestId`, its token usage and its actual
cost. No code change is needed — the port is selected at runtime by whether a credential exists.

**What I will not do:** present the connection as complete before that run has happened. It has not happened,
the stub proves the sequence and not the provider, and §11 of
[`ORCHESTRATOR_V1.md`](ORCHESTRATOR_V1.md) says so in the same words.

---

## What is NOT blocked, and is already done

Everything that does not need the provider was built and tested while this was outstanding: the orchestrator,
task identity and deduplication, retries and failure handling, the circuit breaker, rate limiting, the budget
reservation, the fail-closed approval gate, prompt-injection containment, replay and loop-amplification
protection, monitoring, the owner status view, 42 tests, 12 of 12 mutation proofs, and the documentation.
See [`ORCHESTRATOR_V1.md`](ORCHESTRATOR_V1.md).
