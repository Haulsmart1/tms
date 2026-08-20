"use client";

export default function ShareActions({
  pdfUrl,
}: {
  pdfUrl: string;
}) {
  return (
    <div className="print:hidden flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() =>
          window.print()
        }
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
      >
        PRINT / SAVE PDF
      </button>

      <a
        href={pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
      >
        DOWNLOAD PDF
      </a>
    </div>
  );
}
