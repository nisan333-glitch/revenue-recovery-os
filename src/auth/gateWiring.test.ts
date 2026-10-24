// Structural guards: the sign-in gate cannot be silently unwired, and header identity can only be sent from a
// Vite dev build. These read the source because the property is "this construct exists here", and a rename or a
// refactor that drops it must fail the build rather than ship an unauthenticated production bundle.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("sign-in gate wiring", () => {
  it("the application root is rendered only inside <AuthGate>", () => {
    const main = code("src/main.tsx");
    expect(main).toMatch(/import \{ AuthGate \} from "\.\/auth\/AuthGate"/);
    const gate = main.indexOf("<AuthGate>");
    const app = main.indexOf("<App />");
    const close = main.indexOf("</AuthGate>");
    expect(gate).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(gate);
    expect(close).toBeGreaterThan(app);
  });

  it("dev headers are sent only when the build is a Vite dev build", () => {
    const client = code("src/data/apiClient.ts");
    const idx = client.indexOf('"x-actor-id"');
    expect(idx).toBeGreaterThan(-1);
    expect(client.slice(Math.max(0, idx - 200), idx)).toMatch(/isDevBuild\(\)/);
    expect(client.match(/x-actor-id/g)).toHaveLength(1);
  });

  it("the gate is bypassed only by the dev-build flag or the server's own dev-headers mode", () => {
    const gate = code("src/auth/AuthGate.tsx");
    expect(gate).toMatch(/devBuild = isDevBuild\(\)/);
    expect(gate).toMatch(/devBuild \? \{ kind: "open" \}/);
    expect(gate).toMatch(/config\.mode === "dev-headers"/);
    // The type declaration, the dev-build initial state, and the server's dev-headers answer — nothing else.
    expect(gate.match(/kind: "open"/g)).toHaveLength(3);
  });

  it("no client secret is read, stored or sent anywhere in the browser code", () => {
    for (const f of ["src/auth/oidc.ts", "src/auth/AuthGate.tsx", "src/data/apiClient.ts"]) {
      expect(code(f), f).not.toMatch(/client_secret|clientSecret/);
    }
  });

  it("a 401 from the API signs the user out", () => {
    const client = code("src/data/apiClient.ts");
    expect(client).toMatch(/res\.status === 401[\s\S]{0,200}signOut\(\)/);
  });
});
