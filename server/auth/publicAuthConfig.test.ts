import { describe, expect, it } from "vitest";
import { readPublicAuthConfig } from "./publicAuthConfig";

const full = {
  NODE_ENV: "production",
  NH_OIDC_ISSUER: "https://idp.example.test/",
  NH_OIDC_AUDIENCE: "nh-api",
  NH_OIDC_JWKS_URI: "https://idp.example.test/jwks.json",
  NH_OIDC_CLIENT_ID: "client-public-id",
  NH_OIDC_AUTHORIZATION_ENDPOINT: "https://idp.example.test/authorize",
  NH_OIDC_TOKEN_ENDPOINT: "https://idp.example.test/token",
};

describe("public auth configuration", () => {
  it("production with nothing configured is OIDC, unconfigured, and names variables only", () => {
    const c = readPublicAuthConfig({ NODE_ENV: "production" });
    expect(c.mode).toBe("oidc");
    expect(c).toMatchObject({ configured: false });
    expect((c as { missing: string[] }).missing).toEqual(expect.arrayContaining([
      "NH_OIDC_ISSUER", "NH_OIDC_AUDIENCE", "NH_OIDC_JWKS_URI", "NH_OIDC_CLIENT_ID",
      "NH_OIDC_AUTHORIZATION_ENDPOINT", "NH_OIDC_TOKEN_ENDPOINT",
    ]));
  });

  it("is complete only with every value, and returns no secret-shaped field", () => {
    const c = readPublicAuthConfig(full);
    expect(c).toEqual({
      mode: "oidc", configured: true, issuer: "https://idp.example.test/", clientId: "client-public-id",
      authorizationEndpoint: "https://idp.example.test/authorize", tokenEndpoint: "https://idp.example.test/token",
      scope: "openid", tokenUse: "access_token",
    });
    expect(JSON.stringify(c)).not.toMatch(/secret|password|jwks|audience/i);
  });

  it("rejects non-https endpoints and does not echo the offending value", () => {
    const c = readPublicAuthConfig({ ...full, NH_OIDC_TOKEN_ENDPOINT: "http://idp.example.test/token?x=SENSITIVE" });
    expect(c).toMatchObject({ configured: false, missing: ["NH_OIDC_TOKEN_ENDPOINT"] });
    expect(JSON.stringify(c)).not.toContain("SENSITIVE");
    expect(readPublicAuthConfig({ ...full, NH_OIDC_AUTHORIZATION_ENDPOINT: "https://u:p@idp.example.test/a" }))
      .toMatchObject({ configured: false, missing: ["NH_OIDC_AUTHORIZATION_ENDPOINT"] });
  });

  it("validates token use and scope", () => {
    expect(readPublicAuthConfig({ ...full, NH_OIDC_TOKEN_USE: "id_token", NH_OIDC_SCOPES: "openid profile" }))
      .toMatchObject({ configured: true, tokenUse: "id_token", scope: "openid profile" });
    expect(readPublicAuthConfig({ ...full, NH_OIDC_TOKEN_USE: "refresh_token" })).toMatchObject({ configured: false, missing: ["NH_OIDC_TOKEN_USE"] });
    expect(readPublicAuthConfig({ ...full, NH_OIDC_SCOPES: "openid  \"x" })).toMatchObject({ configured: false, missing: ["NH_OIDC_SCOPES"] });
  });

  it("a mode value outside the closed set is reported as unconfigured, never as dev-headers", () => {
    expect(readPublicAuthConfig({ NODE_ENV: "production", NH_AUTH_MODE: "none" })).toMatchObject({ mode: "oidc", configured: false, missing: ["NH_AUTH_MODE"] });
  });

  it("dev-headers is only ever chosen explicitly or outside production", () => {
    expect(readPublicAuthConfig({})).toEqual({ mode: "dev-headers" });
    expect(readPublicAuthConfig({ NODE_ENV: "production", NH_AUTH_MODE: "dev-headers" })).toEqual({ mode: "dev-headers" });
  });
});
