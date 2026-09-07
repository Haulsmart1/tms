"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import JsBarcode from "jsbarcode";
import Button from "../../components/Button";
import {
  BOX_LABEL_TEMPLATES,
  DEFAULT_CUSTOM_TEMPLATE,
  templateCapacity,
  validateLabelTemplate,
  type LabelTemplate,
} from "../../lib/printing/labelTemplates";
import {
  buildSerializedBoxes,
  formatStopAddress,
  paginateLabels,
  resolveStopSelection,
  type LabelJobItem,
  type LabelStop,
  type SerializedBox,
} from "../../lib/printing/jobLabels";

type Props = {
  jobReference: string;
  customerName: string | null;
  stops: LabelStop[];
  items: LabelJobItem[];
};

function BarcodeSvg({
  value,
}: {
  value: string;
}) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    JsBarcode(ref.current, value, {
      format: "CODE128",
      displayValue: false,
      margin: 0,
      height: 28,
      width: 1.3,
    });
  }, [value]);

  return (
    <svg
      ref={ref}
      aria-label={`Barcode ${value}`}
      className="h-[8mm] w-full"
    />
  );
}

function stopLabel(stop: LabelStop): string {
  return `#${stop.stop_order} - ${formatStopAddress(stop)}`;
}

function numericInput(
  value: number,
  onChange: (value: number) => void,
  min = 0,
  step = 0.1,
) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={value}
      onChange={(event) =>
        onChange(Number(event.target.value))
      }
      className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-ink"
    />
  );
}

export default function JobLabelPrinter({
  jobReference,
  customerName,
  stops,
  items,
}: Props) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] =
    useState(BOX_LABEL_TEMPLATES[0].id);

  const [customTemplate, setCustomTemplate] =
    useState<LabelTemplate>({
      ...DEFAULT_CUSTOM_TEMPLATE,
    });

  const [startPosition, setStartPosition] = useState(1);
  const [collectionId, setCollectionId] = useState("");
  const [deliveryId, setDeliveryId] = useState("");

  const serialized = useMemo(
    () => buildSerializedBoxes(items),
    [items],
  );

  const collections = useMemo(
    () =>
      [...stops]
        .filter((stop) => stop.type === "collection")
        .sort((a, b) => a.stop_order - b.stop_order),
    [stops],
  );

  const deliveries = useMemo(
    () =>
      [...stops]
        .filter((stop) => stop.type === "delivery")
        .sort((a, b) => a.stop_order - b.stop_order),
    [stops],
  );

  const selectedTemplate =
    templateId === "custom"
      ? customTemplate
      : BOX_LABEL_TEMPLATES.find(
          (template) => template.id === templateId,
        ) ?? BOX_LABEL_TEMPLATES[0];

  const capacity = templateCapacity(selectedTemplate);

  const templateError =
    validateLabelTemplate(selectedTemplate);

  const safeCapacity =
    !templateError
    && Number.isInteger(capacity)
    && capacity > 0
      ? capacity
      : 1;

  useEffect(() => {
    if (
      !Number.isInteger(startPosition)
      || startPosition < 1
      || startPosition > safeCapacity
    ) {
      setStartPosition(1);
    }
  }, [safeCapacity, startPosition]);

  useEffect(() => {
    if (collections.length === 1) {
      setCollectionId(collections[0].id);
    }

    if (deliveries.length === 1) {
      setDeliveryId(deliveries[0].id);
    }
  }, [collections, deliveries]);

  const stopSelection = resolveStopSelection(
    stops,
    collectionId,
    deliveryId,
  );

  const printError =
    serialized.boxes.length === 0
      ? "This job has no serialized boxes to print."
      : serialized.duplicateSerials.length > 0
        ? `Duplicate serials exist across different job items: ${serialized.duplicateSerials.join(", ")}`
        : !stopSelection.collection
          ? "Choose the collection address for this print run."
          : !stopSelection.delivery
            ? "Choose the delivery address for this print run."
            : templateError;

  const pages = useMemo(() => {
    if (templateError) {
      return [];
    }

    const safeStartPosition =
      Math.min(
        Math.max(
          1,
          Number.isInteger(startPosition)
            ? startPosition
            : 1,
        ),
        safeCapacity,
      );

    return paginateLabels(
      serialized.boxes,
      selectedTemplate,
      safeStartPosition,
    );
  }, [
    safeCapacity,
    selectedTemplate,
    serialized.boxes,
    startPosition,
    templateError,
  ]);

  const previewStops =
    stopSelection.collection && stopSelection.delivery
      ? {
          collection: stopSelection.collection,
          delivery: stopSelection.delivery,
        }
      : null;

  function updateCustom(
    field: keyof LabelTemplate,
    value: number,
  ) {
    setCustomTemplate((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function printLabels() {
    if (printError) {
      return;
    }

    window.print();
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        Print Labels
      </Button>

      {open ? (
        <div className="fixed inset-0 z-[100] overflow-auto bg-black/50 p-4 print:static print:bg-white print:p-0">
          <style jsx global>{`
            @media print {
              body * {
                visibility: hidden !important;
              }

              .label-print-root,
              .label-print-root * {
                visibility: visible !important;
              }

              .label-print-root {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
              }

              .label-print-controls {
                display: none !important;
              }

              .label-print-page {
                break-after: page;
                page-break-after: always;
              }

              .label-print-page:last-child {
                break-after: auto;
                page-break-after: auto;
              }
            }

            @page {
              size: ${selectedTemplate.pageWidthMm}mm
                ${selectedTemplate.pageHeightMm}mm;
              margin: 0;
            }
          `}</style>

          <div className="mx-auto max-w-5xl rounded-xl bg-surface shadow-xl print:max-w-none print:rounded-none print:shadow-none">
            <div className="label-print-controls border-b border-line p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    Print Box Labels - {jobReference}
                  </h2>

                  <p className="mt-1 text-sm text-ink-2">
                    {serialized.boxes.length} serialized box
                    {serialized.boxes.length === 1 ? "" : "es"}
                    {customerName
                      ? ` - ${customerName}`
                      : ""}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setOpen(false)}
                >
                  Close
                </Button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-xs text-ink-2">
                  Print template
                  <select
                    value={templateId}
                    onChange={(event) => {
                      setTemplateId(event.target.value);
                      setStartPosition(1);
                    }}
                    className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                  >
                    {BOX_LABEL_TEMPLATES.map((template) => (
                      <option
                        key={template.id}
                        value={template.id}
                      >
                        {template.name}
                      </option>
                    ))}

                    <option value="custom">
                      Custom template
                    </option>
                  </select>
                </label>

                <label className="grid gap-1 text-xs text-ink-2">
                  Start at label position
                  <input
                    type="number"
                    min={1}
                    max={safeCapacity}
                    step={1}
                    value={startPosition}
                    onChange={(event) =>
                      setStartPosition(
                        Number(event.target.value),
                      )
                    }
                    className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                  />
                  <span className="text-[11px] text-ink-3">
                    1-{safeCapacity}. Use this for partially used sheets.
                  </span>
                </label>

                {collections.length > 1 ? (
                  <label className="grid gap-1 text-xs text-ink-2">
                    Collection address
                    <select
                      value={collectionId}
                      onChange={(event) =>
                        setCollectionId(event.target.value)
                      }
                      className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                    >
                      <option value="">
                        Choose collection...
                      </option>

                      {collections.map((stop) => (
                        <option
                          key={stop.id}
                          value={stop.id}
                        >
                          {stopLabel(stop)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                {deliveries.length > 1 ? (
                  <label className="grid gap-1 text-xs text-ink-2">
                    Delivery address
                    <select
                      value={deliveryId}
                      onChange={(event) =>
                        setDeliveryId(event.target.value)
                      }
                      className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                    >
                      <option value="">
                        Choose delivery...
                      </option>

                      {deliveries.map((stop) => (
                        <option
                          key={stop.id}
                          value={stop.id}
                        >
                          {stopLabel(stop)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              {templateId === "custom" ? (
                <div className="mt-5 rounded-lg border border-line bg-surface-2 p-4">
                  <div className="mb-3 text-sm font-semibold text-ink">
                    Custom template dimensions
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="grid gap-1 text-xs text-ink-2">
                      Page width mm
                      {numericInput(
                        customTemplate.pageWidthMm,
                        (value) =>
                          updateCustom(
                            "pageWidthMm",
                            value,
                          ),
                        1,
                      )}
                    </label>

                    <label className="grid gap-1 text-xs text-ink-2">
                      Page height mm
                      {numericInput(
                        customTemplate.pageHeightMm,
                        (value) =>
                          updateCustom(
                            "pageHeightMm",
                            value,
                          ),
                        1,
                      )}
                    </label>

                    <label className="grid gap-1 text-xs text-ink-2">
                      Label width mm
                      {numericInput(
                        customTemplate.labelWidthMm,
                        (value) =>
                          updateCustom(
                            "labelWidthMm",
                            value,
                          ),
                        1,
                      )}
                    </label>

                    <label className="grid gap-1 text-xs text-ink-2">
                      Label height mm
                      {numericInput(
                        customTemplate.labelHeightMm,
                        (value) =>
                          updateCustom(
                            "labelHeightMm",
                            value,
                          ),
                        1,
                      )}
                    </label>

                    <label className="grid gap-1 text-xs text-ink-2">
                      Columns
                      {numericInput(
                        customTemplate.columns,
                        (value) =>
                          updateCustom(
                            "columns",
                            value,
                          ),
                        1,
                        1,
                      )}
                    </label>

                    <label className="grid gap-1 text-xs text-ink-2">
                      Rows
                      {numericInput(
                        customTemplate.rows,
                        (value) =>
                          updateCustom(
                            "rows",
                            value,
                          ),
                        1,
                        1,
                      )}
                    </label>

                    <label className="grid gap-1 text-xs text-ink-2">
                      Left margin mm
                      {numericInput(
                        customTemplate.marginLeftMm,
                        (value) =>
                          updateCustom(
                            "marginLeftMm",
                            value,
                          ),
                      )}
                    </label>

                    <label className="grid gap-1 text-xs text-ink-2">
                      Top margin mm
                      {numericInput(
                        customTemplate.marginTopMm,
                        (value) =>
                          updateCustom(
                            "marginTopMm",
                            value,
                          ),
                      )}
                    </label>

                    <label className="grid gap-1 text-xs text-ink-2">
                      Horizontal gap mm
                      {numericInput(
                        customTemplate.gapXmm,
                        (value) =>
                          updateCustom(
                            "gapXmm",
                            value,
                          ),
                      )}
                    </label>

                    <label className="grid gap-1 text-xs text-ink-2">
                      Vertical gap mm
                      {numericInput(
                        customTemplate.gapYmm,
                        (value) =>
                          updateCustom(
                            "gapYmm",
                            value,
                          ),
                      )}
                    </label>
                  </div>
                </div>
              ) : null}

              {printError ? (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  {printError}
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-2">
                  Print at 100% / Actual Size. Disable browser headers
                  and footers. Test new label stock on plain paper before
                  using adhesive sheets.
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <Button
                  type="button"
                  onClick={printLabels}
                  disabled={Boolean(printError)}
                >
                  Print {serialized.boxes.length} Box Label
                  {serialized.boxes.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>

            <div className="label-print-root bg-white">
              {previewStops
                ? pages.map((page, pageIndex) => (
                <div
                  key={pageIndex}
                  className="label-print-page relative bg-white"
                  style={{
                    width: `${selectedTemplate.pageWidthMm}mm`,
                    height: `${selectedTemplate.pageHeightMm}mm`,
                  }}
                >
                  {page.map((box, slotIndex) => {
                    if (!box) {
                      return null;
                    }

                    const row = Math.floor(
                      slotIndex / selectedTemplate.columns,
                    );

                    const column =
                      slotIndex % selectedTemplate.columns;

                    const left =
                      selectedTemplate.marginLeftMm +
                      column *
                        (
                          selectedTemplate.labelWidthMm +
                          selectedTemplate.gapXmm
                        );

                    const top =
                      selectedTemplate.marginTopMm +
                      row *
                        (
                          selectedTemplate.labelHeightMm +
                          selectedTemplate.gapYmm
                        );

                    const absoluteBoxNumber =
                      serialized.boxes.findIndex(
                        (candidate) =>
                          candidate.jobItemId === box.jobItemId &&
                          candidate.serial === box.serial,
                      ) + 1;

                    return (
                      <BoxLabel
                        key={`${box.jobItemId}-${box.serial}`}
                        box={box}
                        boxNumber={absoluteBoxNumber}
                        totalBoxes={serialized.boxes.length}
                        jobReference={jobReference}
                        collection={
                          previewStops.collection
                        }
                        delivery={
                          previewStops.delivery
                        }
                        widthMm={
                          selectedTemplate.labelWidthMm
                        }
                        heightMm={
                          selectedTemplate.labelHeightMm
                        }
                        leftMm={left}
                        topMm={top}
                      />
                    );
                  })}
                </div>
                  ))
                : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function BoxLabel({
  box,
  boxNumber,
  totalBoxes,
  jobReference,
  collection,
  delivery,
  widthMm,
  heightMm,
  leftMm,
  topMm,
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

  return (
    <article
      className="absolute box-border overflow-hidden border border-slate-300 bg-white text-black"
      style={{
        left: `${leftMm}mm`,
        top: `${topMm}mm`,
        width: `${widthMm}mm`,
        height: `${heightMm}mm`,
        padding: compact ? "1.6mm" : "3mm",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <div
        className="flex items-start justify-between gap-2 font-bold"
        style={{
          fontSize: compact ? "7.5pt" : "11pt",
          lineHeight: 1.05,
        }}
      >
        <span className="truncate">
          JOB {jobReference}
        </span>

        <span className="shrink-0">
          BOX {boxNumber}/{totalBoxes}
        </span>
      </div>

      <div
        className="mt-[1mm] grid gap-[0.6mm]"
        style={{
          fontSize: compact ? "6.2pt" : "9pt",
          lineHeight: 1.1,
        }}
      >
        <div className="line-clamp-2">
          <strong>FROM:</strong>{" "}
          {formatStopAddress(collection)}
        </div>

        <div className="line-clamp-2">
          <strong>TO:</strong>{" "}
          {formatStopAddress(delivery)}
        </div>

        {!compact && (box.sku || box.description) ? (
          <div className="truncate">
            <strong>ITEM:</strong>{" "}
            {[box.sku, box.description]
              .filter(Boolean)
              .join(" - ")}
          </div>
        ) : null}
      </div>

      <div className={compact ? "mt-[0.8mm]" : "mt-[2mm]"}>
        <BarcodeSvg value={box.serial} />

        <div
          className="truncate text-center font-mono font-semibold"
          style={{
            fontSize: compact ? "6.5pt" : "9pt",
            lineHeight: 1,
          }}
        >
          {box.serial}
        </div>
      </div>
    </article>
  );
}
