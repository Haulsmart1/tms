import { describe, expect, it } from "vitest";
import {
  intakeCorsHeaders,
  isHoneypotFilled,
  isIntakeOriginAllowed,
  readPublicToken,
  requestOriginFromHeaders,
} from "./intakeSecurity";

const TOKEN = "Abc_def-0123456789ABCDEFGHIJKLMNOPQRS";

describe("readPublicToken", () => {
  it("accepts a well-formed token and trims it", () => {
    expect(readPublicToken(` ${TOKEN} `)).toBe(TOKEN);
  });

  it("returns null for malformed percent-encoding instead of throwing", () => {
    expect(readPublicToken(`${TOKEN}%E0%A4%A`)).toBeNull();
  });

  it("rejects short, oversized and odd-character tokens", () => {
    expect(readPublicToken("short")).toBeNull();
    expect(readPublicToken("a".repeat(513))).toBeNull();
    expect(readPublicToken(`${TOKEN}<script>`)).toBeNull();
  });
});

describe("requestOriginFromHeaders", () => {
  it("uses Origin, then the Referer's origin, and ignores junk", () => {
    expect(requestOriginFromHeaders(new Headers({ origin: "https://haulier.example" }))).toBe("https://haulier.example");
    expect(requestOriginFromHeaders(new Headers({ referer: "https://haulier.example/quote?x=1" }))).toBe(
      "https://haulier.example"
    );
    expect(requestOriginFromHeaders(new Headers({ origin: "null" }))).toBeNull();
    expect(requestOriginFromHeaders(new Headers())).toBeNull();
  });
});

describe("isIntakeOriginAllowed", () => {
  it("requires a matching origin when one is configured, even if the request sends none", () => {
    expect(isIntakeOriginAllowed("https://haulier.example", "https://haulier.example")).toBe(true);
    expect(isIntakeOriginAllowed("https://haulier.example/", "https://haulier.example")).toBe(true);
    expect(isIntakeOriginAllowed("https://haulier.example", null)).toBe(false);
    expect(isIntakeOriginAllowed("https://haulier.example", "https://evil.example")).toBe(false);
  });

  it("allows any origin when none is configured, and fails closed on a malformed one", () => {
    expect(isIntakeOriginAllowed(null, null)).toBe(true);
    expect(isIntakeOriginAllowed("  ", "https://anywhere.example")).toBe(true);
    expect(isIntakeOriginAllowed("not a url", "https://haulier.example")).toBe(false);
  });
});

describe("intakeCorsHeaders", () => {
  it("only allows the configured origin", () => {
    expect(intakeCorsHeaders("https://haulier.example", "https://haulier.example")).toEqual({
      Vary: "Origin",
      "Access-Control-Allow-Origin": "https://haulier.example",
    });
    expect(intakeCorsHeaders("https://haulier.example", "https://evil.example")).toEqual({ Vary: "Origin" });
    expect(intakeCorsHeaders(null, "https://haulier.example")).toEqual({ Vary: "Origin" });
  });
});

describe("isHoneypotFilled", () => {
  it("flags a filled honeypot but not an empty one", () => {
    expect(isHoneypotFilled({ _honey: "" })).toBe(false);
    expect(isHoneypotFilled({ name: "Jane" })).toBe(false);
    expect(isHoneypotFilled({ _gotcha: "http://spam.example" })).toBe(true);
  });
});
