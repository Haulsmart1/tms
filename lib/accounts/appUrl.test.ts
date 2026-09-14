import { describe, expect, it } from "vitest";
import { DEFAULT_PUBLIC_ORIGIN, publicAppOrigin } from "./appUrl";

describe("publicAppOrigin", () => {
  it("prefers the configured site URL and ignores the request host", () => {
    expect(
      publicAppOrigin("https://attacker.example/api/x", {
        NEXT_PUBLIC_SITE_URL: "https://app.tms.test/",
        NODE_ENV: "production",
      }),
    ).toBe("https://app.tms.test");
  });

  it("never uses the request host in production", () => {
    expect(publicAppOrigin("https://attacker.example/api/x", { NODE_ENV: "production" })).toBe(DEFAULT_PUBLIC_ORIGIN);
  });

  it("uses the request origin in development", () => {
    expect(publicAppOrigin("http://localhost:3000/api/x", { NODE_ENV: "development" })).toBe("http://localhost:3000");
  });

  it("ignores a malformed configured value", () => {
    expect(
      publicAppOrigin(null, { NEXT_PUBLIC_SITE_URL: "javascript:alert(1)", NODE_ENV: "production" }),
    ).toBe(DEFAULT_PUBLIC_ORIGIN);
  });
});
