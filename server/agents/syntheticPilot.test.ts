import { describe, expect, it } from "vitest";
import { assertSyntheticPilotEnvironment } from "./syntheticPilot";

describe("synthetic pilot environment guard", () => {
  it("accepts only an explicit opt-in and a disposable local PostgreSQL database", () => {
    expect(assertSyntheticPilotEnvironment({
      NH_SYNTHETIC_PILOT: "true",
      DATABASE_URL: "postgresql://pilot:secret@localhost:5432/nh_synthetic_test?schema=public",
    }).pathname).toBe("/nh_synthetic_test");
  });

  it.each([
    [{ DATABASE_URL: "postgresql://pilot:secret@localhost:5432/nh_test" }, "NH_SYNTHETIC_PILOT=true"],
    [{ NH_SYNTHETIC_PILOT: "true" }, "DATABASE_URL is required"],
    [{ NH_SYNTHETIC_PILOT: "true", DATABASE_URL: "mysql://pilot:secret@localhost/nh_test" }, "requires PostgreSQL"],
    [{ NH_SYNTHETIC_PILOT: "true", DATABASE_URL: "postgresql://pilot:secret@localhost/revenue" }, "database name"],
    [{ NH_SYNTHETIC_PILOT: "true", DATABASE_URL: "postgresql://pilot:secret@example.com/nh_test" }, "local or disposable"],
  ])("refuses unsafe configuration %#", (env, message) => {
    expect(() => assertSyntheticPilotEnvironment(env)).toThrow(message);
  });
});
