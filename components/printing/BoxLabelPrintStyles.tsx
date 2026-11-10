import type { LabelTemplate } from "../../lib/printing/labelTemplates";

/** Label dialogs are portalled to body so the application can be removed from
 * the print layout entirely. Hidden app content would still use paper. */
export default function BoxLabelPrintStyles({ template }: { template: LabelTemplate }) {
  return (
    <style>{`
      @media print {
        body > :not(.box-label-print-dialog),
        .box-label-print-controls {
          display: none !important;
        }

        html, body, .box-label-print-dialog {
          display: block !important;
          position: static !important;
          min-height: 0 !important;
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: visible !important;
          background: white !important;
        }

        .box-label-print-page {
          break-inside: avoid;
        }

        .box-label-print-page + .box-label-print-page {
          break-before: page;
        }
      }

      @page {
        size: ${template.pageWidthMm}mm ${template.pageHeightMm}mm;
        margin: 0;
      }
    `}</style>
  );
}
