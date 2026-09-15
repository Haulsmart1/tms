import { describe, expect, it } from "vitest";
import { validateWebhookUrl } from "./webhookUrl";

describe("validateWebhookUrl", () => {
  it("accepts public https URLs and clears blanks", () => {
    expect(validateWebhookUrl("https://hooks.example.com/tms")).toEqual({
      ok: true,
      value: "https://hooks.example.com/tms",
    });
    expect(validateWebhookUrl("  ")).toEqual({ ok: true, value: null });
    expect(validateWebhookUrl(null)).toEqual({ ok: true, value: null });
  });

  it.each([
    "http://hooks.example.com/",
    "https://169.254.169.254/latest/meta-data",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://10.0.0.5/",
    "https://172.20.1.1/",
    "https://192.168.1.1/",
    "https://100.64.0.1/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://[64:ff9b::169.254.169.254]/",
    "https://[64:ff9b::a9fe:a9fe]/",
    "https://[64:ff9b::127.0.0.1]/",
    "https://[64:ff9b::a00:5]/",
    "https://localhost/",
    "https://db.internal/",
    "https://printer.local/",
    "https://intranet/",
    "https://user:pass@hooks.example.com/",
    "ftp://hooks.example.com/",
    "not a url",
    42,
  ])("rejects %s", (value) => {
    expect(validateWebhookUrl(value).ok).toBe(false);
  });
});
