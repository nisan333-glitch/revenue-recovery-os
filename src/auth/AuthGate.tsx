// Fail-closed sign-in gate for the production SPA. It renders the application only after the SERVER has accepted
// the bearer token (`GET /api/auth/whoami` → verified actor + role). The gate decides nothing about authority.
//
// - Vite DEV build: bypassed, because the local dev-header identity is the only one there (and the server refuses
//   it for any non-loopback request). The browser journey runs in this mode.
// - Server in dev-headers mode (private loopback pilot): the app renders as before; the server enforces its own
//   loopback rule on every request.
// - Server in OIDC mode: nothing renders until a verified identity exists.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AUTH_EXPIRED_EVENT, beginAuthorization, completeAuthorization, isDevBuild, parseCallback,
  SignInError, rememberFlow, signOut, validStoredToken, type AuthConfigDTO, type OidcClientConfig,
} from "./oidc";

type State =
  | { kind: "loading" }
  | { kind: "open" }
  | { kind: "unconfigured"; missing: readonly string[] }
  | { kind: "signed-out"; config: OidcClientConfig; notice?: string }
  | { kind: "working" }
  | { kind: "signed-in"; config: OidcClientConfig; actorId: string; role: string }
  | { kind: "failed"; message: string };

const redirectUri = (): string => `${window.location.origin}/`;

async function loadConfig(): Promise<AuthConfigDTO> {
  const res = await fetch("/api/auth/config", { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error("config");
  return (await res.json()) as AuthConfigDTO;
}

async function whoami(token: string): Promise<{ actorId: string; role: string } | null> {
  const res = await fetch("/api/auth/whoami", { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as { actorId?: unknown; role?: unknown };
  return typeof body.actorId === "string" && typeof body.role === "string" ? { actorId: body.actorId, role: body.role } : null;
}

export interface AuthGateProps {
  readonly children?: ReactNode;
  /** Test seam. Defaults to the build flag; only a Vite dev build ever bypasses the gate by itself. */
  readonly devBuild?: boolean;
  /** Test seam for the redirect to the identity provider. Defaults to `window.location.assign`. */
  readonly navigate?: (url: string) => void;
}

export function AuthGate({ children, devBuild = isDevBuild(), navigate = (url) => window.location.assign(url) }: AuthGateProps) {
  const [state, setState] = useState<State>(devBuild ? { kind: "open" } : { kind: "loading" });

  const resolve = useCallback(async () => {
    try {
      const config = await loadConfig();
      if (config.mode === "dev-headers") { setState({ kind: "open" }); return; }
      if (!config.configured) { setState({ kind: "unconfigured", missing: config.missing }); return; }
      const client: OidcClientConfig = config;
      const callback = parseCallback(window.location.search);
      if (callback.kind !== "none") {
        // Remove the code/state from the address bar before anything else happens.
        window.history.replaceState(null, "", window.location.pathname);
        if (callback.kind === "error") { setState({ kind: "signed-out", config: client, notice: `Sign-in was not completed (${callback.error}).` }); return; }
        setState({ kind: "working" });
        await completeAuthorization(client, callback, redirectUri());
      }
      const token = validStoredToken();
      if (!token) { setState({ kind: "signed-out", config: client }); return; }
      const who = await whoami(token);
      if (!who) { signOut(); setState({ kind: "signed-out", config: client, notice: "Your session was not accepted. Please sign in again." }); return; }
      setState({ kind: "signed-in", config: client, ...who });
    } catch (error) {
      setState({ kind: "failed", message: error instanceof SignInError ? error.message : "Sign-in is unavailable. Nothing was loaded." });
    }
  }, []);

  useEffect(() => {
    if (devBuild) return;
    void resolve();
    const onExpired = () => { void resolve(); };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
  }, [resolve, devBuild]);

  const startSignIn = async (config: OidcClientConfig) => {
    const request = await beginAuthorization(config, redirectUri());
    rememberFlow(request);
    navigate(request.url);
  };

  if (state.kind === "open" || state.kind === "signed-in") {
    return (
      <>
        {state.kind === "signed-in" && (
          <div data-testid="auth-bar" className="flex items-center justify-end gap-3 border-b border-slate-200 bg-slate-50 px-4 py-1 text-xs text-slate-600">
            <span>Signed in as <strong>{state.actorId}</strong> · role <strong>{state.role}</strong> (verified by the server)</span>
            <button type="button" className="underline" onClick={() => { signOut(); void resolve(); }}>Sign out</button>
          </div>
        )}
        {children}
      </>
    );
  }

  return (
    <main data-testid="auth-gate" className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 p-6 text-slate-800">
      <h1 className="text-xl font-semibold">NH · Revenue Recovery OS</h1>
      {state.kind === "loading" || state.kind === "working" ? <p role="status">Checking sign-in…</p> : null}
      {state.kind === "unconfigured" && (
        <div role="alert" className="space-y-2">
          <p>Sign-in is not configured on this server, so no data is shown.</p>
          <p className="text-sm text-slate-600">The deployment owner must set: {state.missing.join(", ")}.</p>
        </div>
      )}
      {state.kind === "failed" && (
        <div className="space-y-3">
          <p role="alert">{state.message}</p>
          <button type="button" className="underline" onClick={() => { setState({ kind: "loading" }); void resolve(); }}>Try again</button>
        </div>
      )}
      {state.kind === "signed-out" && (
        <div className="space-y-3">
          {state.notice && <p role="alert" className="text-sm text-amber-700">{state.notice}</p>}
          <p>Sign in with your organisation account. The server verifies your identity and role on every request.</p>
          <button type="button" className="rounded bg-slate-900 px-4 py-2 text-white" onClick={() => { void startSignIn(state.config); }}>Sign in</button>
        </div>
      )}
    </main>
  );
}


