import { describe, expect, it } from "vitest";
import { whatsappDigits, whatsappTrackingUrl } from "./whatsapp";

describe("whatsappDigits", () => {
  it("turns a UK 07 mobile into 44", () => {
    expect(whatsappDigits("07700 900123")).toBe("447700900123");
  });

  it("strips a leading +", () => {
    expect(whatsappDigits("+44 7700 900123")).toBe("447700900123");
  });

  it("strips a leading 00 international prefix", () => {
    expect(whatsappDigits("0044 7700 900123")).toBe("447700900123");
    expect(whatsappDigits("0048 512 345 678")).toBe("48512345678");
  });

  it("drops spaces, dashes, dots and brackets", () => {
    expect(whatsappDigits("(07700) 900-123")).toBe("447700900123");
    expect(whatsappDigits("+44-7700.900.123")).toBe("447700900123");
  });

  it("drops a UK trunk 0 written after the 44 country code", () => {
    expect(whatsappDigits("+44 07700 900123")).toBe("447700900123");
    expect(whatsappDigits("+44 (0)7700 900123")).toBe("447700900123");
    expect(whatsappDigits("0044 07700 900123")).toBe("447700900123");
    expect(whatsappDigits("4407700900123")).toBe("447700900123");
  });

  it("keeps an international number without a prefix as given", () => {
    expect(whatsappDigits("447700900123")).toBe("447700900123");
  });

  it("refuses a number with fewer than 10 digits", () => {
    expect(whatsappDigits("0770090")).toBeNull();
    expect(whatsappDigits("123456789")).toBeNull();
    expect(whatsappDigits("")).toBeNull();
    expect(whatsappDigits("   ")).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
  });

  it("refuses a value with letters in it", () => {
    expect(whatsappDigits("call 07700 900123")).toBeNull();
  });

  it("refuses more than 15 digits, the E.164 maximum", () => {
    expect(whatsappDigits("+44 7700 900123 456789")).toBeNull();
  });
});

describe("whatsappTrackingUrl", () => {
  it("builds a wa.me link with the encoded message", () => {
    const url = whatsappTrackingUrl("07700 900123", "https://app.example/track/trk_abc");
    expect(url).toBe(
      `https://wa.me/447700900123?text=${encodeURIComponent("Track your delivery: https://app.example/track/trk_abc")}`,
    );
  });

  it("returns null when the number is unusable", () => {
    expect(whatsappTrackingUrl("123", "https://app.example/track/trk_abc")).toBeNull();
  });
});
