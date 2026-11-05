"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { formatStopAddress, type LabelStop, type SerializedBox } from "../../lib/printing/jobLabels";

/** Shared by individual-job and whole-vehicle printing. Contact details belong
 * to the selected collection stop, not the transport customer's account. */
export default function PrintedBoxLabel({
  box, boxNumber, totalBoxes, jobReference, collection, delivery,
  widthMm, heightMm, leftMm, topMm,
}: {
  box: SerializedBox;
  boxNumber: number;
  totalBoxes: number;
  jobReference: string;
  collection: LabelStop;
  delivery: LabelStop;
  widthMm: number;
  heightMm: number;
  leftMm: number;
  topMm: number;
}) {
  const compact = heightMm < 45;
  const barcodeRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    if (barcodeRef.current) {
      JsBarcode(barcodeRef.current, box.serial, {
        format: "CODE128", displayValue: false, margin: 0, height: 28, width: 1.3,
      });
    }
  }, [box.serial]);

  return (
    <article
      data-box-label={jobReference}
      style={{
        position: "absolute", boxSizing: "border-box", overflow: "hidden",
        border: "1px solid #cbd5e1", background: "white", color: "black",
        left: `${leftMm}mm`, top: `${topMm}mm`, width: `${widthMm}mm`, height: `${heightMm}mm`,
        padding: compact ? "0.8mm" : "3mm", fontFamily: "Arial, Helvetica, sans-serif",
        display: "flex", flexDirection: "column", gap: compact ? "0.3mm" : "1.5mm",
      }}
    >
      <div data-label-fit style={{ display: "flex", justifyContent: "space-between", gap: "1mm", flexShrink: 0,
        fontWeight: 700, fontSize: compact ? "7.5pt" : "11pt", lineHeight: 1.05 }}>
        <span>JOB {jobReference}</span>
        <span style={{ whiteSpace: "nowrap" }}>BOX {boxNumber}/{totalBoxes}</span>
      </div>
      <div data-label-fit style={{ flex: "1 1 auto", minHeight: 0, fontSize: compact ? "6.2pt" : "9pt", lineHeight: 1.1 }}>
        <div data-label-content style={{ display: "grid", gap: compact ? "0.3mm" : "0.8mm", overflowWrap: "anywhere" }}>
          <div><strong>NAME:</strong> {collection.contact_name?.trim() || "Not recorded"}</div>
          <div><strong>TEL:</strong> {collection.contact_phone?.trim() || "Not recorded"}</div>
          <div><strong>FROM:</strong> {formatStopAddress(collection)}</div>
          <div><strong>TO:</strong> {formatStopAddress(delivery)}</div>
          {!compact && (box.sku || box.description) ? (
            <div><strong>ITEM:</strong> {[box.sku, box.description].filter(Boolean).join(" - ")}</div>
          ) : null}
        </div>
      </div>
      <div data-label-fit style={{ flexShrink: 0 }}>
        <svg ref={barcodeRef} aria-label={`Barcode ${box.serial}`} style={{ display: "block", height: "8mm", width: "100%" }} />
        <div style={{ textAlign: "center", fontFamily: "monospace", fontWeight: 600,
          whiteSpace: "nowrap", fontSize: compact ? "6.5pt" : "9pt", lineHeight: 1 }}>
          {box.serial}
        </div>
      </div>
    </article>
  );
}

/** Refuse to silently cut off long names, addresses or barcodes on small or
 * custom stock. Check the actual rendered label before opening print. */
export function labelLayoutError(root: HTMLElement | null): string | null {
  if (!root) return "Open the label preview before printing.";
  for (const label of root.querySelectorAll<HTMLElement>("[data-box-label]")) {
    const blocks = label.querySelectorAll<HTMLElement>("[data-label-fit]");
    if (label.scrollHeight > label.clientHeight + 1 || label.scrollWidth > label.clientWidth + 1 ||
      Array.from(blocks).some((block) => block.scrollHeight > block.clientHeight + 1 || block.scrollWidth > block.clientWidth + 1)) {
      return `${label.dataset.boxLabel}: details do not fit this label size. Choose a larger label template before printing.`;
    }
    if (!label.querySelector("svg rect")) return "Barcodes are still loading. Try printing again in a moment.";
  }
  return null;
}
