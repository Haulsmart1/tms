"use client";

import { useState } from "react";

export default function ShareActions({
  pdfUrl,
}: {
  pdfUrl: string;
}) {
  const [copied, setCopied] =
    useState(false);

  async function copyCurrentLink() {
    try {
      await navigator.clipboard.writeText(
        window.location.href
      );

      setCopied(true);

      window.setTimeout(
        () => setCopied(false),
        2000
      );
    } catch {
      window.prompt(
        "Copy this secure POD link:",
        window.location.href
      );
    }
  }

  return (
    <div className="print:hidden flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() =>
          window.print()
        }
        className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:border-blue-500 hover:bg-slate-800"
      >
        PRINT / SAVE PDF
      </button>

      <a
        href={pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:border-blue-500 hover:bg-slate-800"
      >
        DOWNLOAD PDF
      </a>

      <button
        type="button"
        onClick={() =>
          void copyCurrentLink()
        }
        className="rounded-lg border border-slate-600 bg-slate-900 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:border-blue-500 hover:bg-slate-800"
      >
        {copied
          ? "LINK COPIED"
          : "COPY LINK"}
      </button>
    </div>
  );
}
