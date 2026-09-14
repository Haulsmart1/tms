import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { embedUnicodeFonts } from "./pdfFonts";
import { fitPdfText, loadPdfLogo, wrapPdfText } from "./pdfText";

async function fonts() {
  const pdf = await PDFDocument.create();
  return { pdf, ...(await embedUnicodeFonts(pdf)) };
}

describe("wrapPdfText", () => {
  it("never returns a line wider than maxWidth, even for one unbreakable word", async () => {
    const { regular } = await fonts();
    const word = "RMA-2026-000123-CAMBRIDGE-AUDIO-RETURNS-GB29NWBK60161331926819";
    const lines = wrapPdfText(`Ref ${word} end`, regular, 8, 80);
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) {
      expect(regular.widthOfTextAtSize(line, 8)).toBeLessThanOrEqual(80);
    }
    expect(lines.join("").replace(/\s/g, "")).toBe(`Ref${word}end`);
  });

  it("keeps explicit line breaks and blank lines, and keeps accented text", async () => {
    const { regular } = await fonts();
    expect(wrapPdfText("Łódź €12.50\n\nİstanbul", regular, 9, 400)).toEqual(["Łódź €12.50", "", "İstanbul"]);
  });

  it("returns a single empty line for null input", async () => {
    const { regular } = await fonts();
    expect(wrapPdfText(null, regular, 9, 100)).toEqual([""]);
  });
});

describe("fitPdfText", () => {
  it("returns short text unchanged and truncates long text with an ellipsis", async () => {
    const { bold } = await fonts();
    expect(fitPdfText("Short", bold, 8, 200)).toBe("Short");
    const fitted = fitPdfText("A very long trading name that will never fit in the box", bold, 8, 60);
    expect(fitted.endsWith("...")).toBe(true);
    expect(bold.widthOfTextAtSize(fitted, 8)).toBeLessThanOrEqual(60);
  });
});

describe("loadPdfLogo", () => {
  it("returns null instead of hanging when the logo host never answers", async () => {
    const { pdf } = await fonts();
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")));
        })
    ) as unknown as typeof fetch;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(loadPdfLogo(pdf, "https://logo.example/x.png", { timeoutMs: 20, fetchImpl })).resolves.toBeNull();
    warn.mockRestore();
  });

  it("returns null for an HTTP error or undecodable bytes", async () => {
    const { pdf } = await fonts();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notFound = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    await expect(loadPdfLogo(pdf, "https://logo.example/a", { fetchImpl: notFound })).resolves.toBeNull();
    const garbage = vi.fn(async () => new Response("not an image", { status: 200 })) as unknown as typeof fetch;
    await expect(loadPdfLogo(pdf, "https://logo.example/b", { fetchImpl: garbage })).resolves.toBeNull();
    warn.mockRestore();
  });
});
