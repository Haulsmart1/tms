"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import PrintedBoxLabel, { labelLayoutError } from "../../components/printing/PrintedBoxLabel";
import BoxLabelPrintStyles from "../../components/printing/BoxLabelPrintStyles";
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
} from "../../lib/printing/jobLabels";

type Props = {
  jobReference: string;
  customerName: string | null;
  stops: LabelStop[];
  items: LabelJobItem[];
};

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
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const printRootRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => { setLayoutError(null); }, [selectedTemplate, collectionId, deliveryId]);

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

  /* The overlay is portaled to document.body, so nothing puts it in the Tab
     order next to its trigger. Move focus in on open and, on close, back to
     whatever had it (the Print Labels button: Button does not forward refs,
     but the click that opened the overlay left focus on it). */
  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    overlayRef.current?.focus();
    return () => {
      opener?.focus();
    };
  }, [open]);

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

    const error = labelLayoutError(printRootRef.current);
    setLayoutError(error);
    if (!error) window.print();
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

      {open
        ? createPortal(
            <div
              ref={overlayRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  /* Modal (components/Modal.tsx) listens for Escape on
                     document, which is also React's root container here,
                     so a plain stopPropagation would not reach it. */
                  e.nativeEvent.stopImmediatePropagation();
                  setOpen(false);
                }
              }}
              className="box-label-print-dialog ds fixed inset-0 z-[100] overflow-auto bg-black/50 p-4 font-sans text-ink outline-none print:static print:bg-white print:p-0"
            >
          <BoxLabelPrintStyles template={selectedTemplate} />

          <div className="mx-auto max-w-5xl rounded-xl bg-surface shadow-xl print:max-w-none print:rounded-none print:shadow-none">
            <div className="box-label-print-controls border-b border-line p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 id={titleId} className="text-lg font-semibold text-ink">
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
                  {pages.length} {pages.length === 1 ? "sheet" : "sheets"}. Print at 100% / Actual Size. Disable browser headers
                  and footers. Test new label stock on plain paper before
                  using adhesive sheets.
                </div>
              )}

              {layoutError ? <div role="alert" className="mt-3 text-sm text-red-700">{layoutError}</div> : null}

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

            <div ref={printRootRef} className="bg-white">
              {previewStops
                ? pages.map((page, pageIndex) => (
                <div
                  key={pageIndex}
                  className="box-label-print-page relative bg-white"
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
                      <PrintedBoxLabel
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
        </div>,
            document.body
          )
        : null}
    </>
  );
}
