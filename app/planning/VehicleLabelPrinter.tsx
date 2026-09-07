"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import JsBarcode from "jsbarcode";
import Button from "../../components/Button";
import type {
  PlanJob,
  PlanStop,
} from "../../lib/planning/types";
import {
  BOX_LABEL_TEMPLATES,
  DEFAULT_CUSTOM_TEMPLATE,
  templateCapacity,
  validateLabelTemplate,
  type LabelTemplate,
} from "../../lib/printing/labelTemplates";
import {
  formatStopAddress,
  paginateLabels,
  type LabelStop,
} from "../../lib/printing/jobLabels";
import {
  buildVehicleLabels,
  type VehicleLabel,
  type VehicleLabelStopSelections,
} from "../../lib/printing/vehicleLabels";

type Props = {
  vehicleRegistration: string;
  jobs: PlanJob[];
};

function labelStop(stop: PlanStop): LabelStop | null {
  if (
    stop.type !== "collection"
    && stop.type !== "delivery"
  ) {
    return null;
  }

  return {
    id: stop.id,
    stop_order: stop.stop_order,
    type: stop.type,
    address_line: stop.address_line,
    city: stop.city,
    postcode: stop.postcode,
  };
}

function BarcodeSvg({ value }: { value: string }) {
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

export default function VehicleLabelPrinter({
  vehicleRegistration,
  jobs,
}: Props) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] =
    useState(BOX_LABEL_TEMPLATES[0].id);
  const [customTemplate, setCustomTemplate] =
    useState<LabelTemplate>({
      ...DEFAULT_CUSTOM_TEMPLATE,
    });
  const [startPosition, setStartPosition] = useState(1);
  const [stopSelections, setStopSelections] =
    useState<VehicleLabelStopSelections>({});

  const printableJobs = useMemo(
    () =>
      jobs.map((job) => ({
        id: job.id,
        reference: job.reference,
        stops: job.stops
          .map(labelStop)
          .filter((stop): stop is LabelStop => stop !== null),
        items: job.items ?? [],
      })),
    [jobs],
  );

  const jobsWithBoxes = useMemo(
    () =>
      printableJobs.filter((job) =>
        job.items.some(
          (item) =>
            (item.serial_numbers ?? []).some(
              (serial) => String(serial ?? "").trim() !== "",
            ),
        ),
      ),
    [printableJobs],
  );

  const emptyJobs = useMemo(
    () =>
      printableJobs.filter(
        (job) => !jobsWithBoxes.some(
          (candidate) => candidate.id === job.id,
        ),
      ),
    [jobsWithBoxes, printableJobs],
  );

  useEffect(() => {
    setStopSelections((current) => {
      const next = { ...current };

      for (const job of jobsWithBoxes) {
        const collections = job.stops
          .filter((stop) => stop.type === "collection")
          .sort((a, b) => a.stop_order - b.stop_order);

        const deliveries = job.stops
          .filter((stop) => stop.type === "delivery")
          .sort((a, b) => a.stop_order - b.stop_order);

        next[job.id] = {
          collectionId:
            current[job.id]?.collectionId
            ?? (collections.length === 1
              ? collections[0].id
              : undefined),
          deliveryId:
            current[job.id]?.deliveryId
            ?? (deliveries.length === 1
              ? deliveries[0].id
              : undefined),
        };
      }

      return next;
    });
  }, [jobsWithBoxes]);

  const batch = useMemo(
    () => buildVehicleLabels(jobsWithBoxes, stopSelections),
    [jobsWithBoxes, stopSelections],
  );

  const selectedTemplate =
    templateId === "custom"
      ? customTemplate
      : BOX_LABEL_TEMPLATES.find(
          (template) => template.id === templateId,
        ) ?? BOX_LABEL_TEMPLATES[0];

  const capacity = templateCapacity(selectedTemplate);
  const templateError = validateLabelTemplate(selectedTemplate);

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

  const pages = useMemo(() => {
    if (templateError || batch.labels.length === 0) {
      return [];
    }

    return paginateLabels(
      batch.labels,
      selectedTemplate,
      Math.min(
        Math.max(
          1,
          Number.isInteger(startPosition)
            ? startPosition
            : 1,
        ),
        safeCapacity,
      ),
    );
  }, [
    batch.labels,
    safeCapacity,
    selectedTemplate,
    startPosition,
    templateError,
  ]);

  const blockingErrors = batch.errors;
  const printError =
    jobsWithBoxes.length === 0
      ? "This vehicle has no serialized boxes to print."
      : blockingErrors.length > 0
        ? "Resolve the label issues below before printing."
        : templateError;

  function updateStop(
    jobId: string,
    field: "collectionId" | "deliveryId",
    value: string,
  ) {
    setStopSelections((current) => ({
      ...current,
      [jobId]: {
        ...current[jobId],
        [field]: value || undefined,
      },
    }));
  }

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
    if (!printError) {
      window.print();
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        disabled={jobs.length === 0}
      >
        Print All Labels
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] overflow-auto bg-black/50 p-4 print:static print:bg-white print:p-0"
          onClick={(event) => event.stopPropagation()}
        >
          <style jsx global>{`
            @media print {
              body * {
                visibility: hidden !important;
              }

              .vehicle-label-print-root,
              .vehicle-label-print-root * {
                visibility: visible !important;
              }

              .vehicle-label-print-root {
                position: absolute !important;
                left: 0 !important;
                top: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
              }

              .vehicle-label-print-controls {
                display: none !important;
              }

              .vehicle-label-print-page {
                break-after: page;
                page-break-after: always;
              }

              .vehicle-label-print-page:last-child {
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
            <div className="vehicle-label-print-controls border-b border-line p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    Print Vehicle Labels - {vehicleRegistration}
                  </h2>
                  <p className="mt-1 text-sm text-ink-2">
                    {batch.labels.length} serialized box
                    {batch.labels.length === 1 ? "" : "es"} across{" "}
                    {jobsWithBoxes.length} job
                    {jobsWithBoxes.length === 1 ? "" : "s"}
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

              {emptyJobs.length > 0 ? (
                <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-2">
                  No serialized boxes for:{" "}
                  {emptyJobs
                    .map((job) => job.reference ?? job.id)
                    .join(", ")}.
                  These jobs will not produce labels.
                </div>
              ) : null}

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
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                    <option value="custom">Custom template</option>
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
                      setStartPosition(Number(event.target.value))
                    }
                    className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                  />
                  <span className="text-[11px] text-ink-3">
                    1-{safeCapacity}. Use for partially used sheets.
                  </span>
                </label>
              </div>

              {jobsWithBoxes.map((job) => {
                const collections = job.stops
                  .filter((stop) => stop.type === "collection")
                  .sort((a, b) => a.stop_order - b.stop_order);

                const deliveries = job.stops
                  .filter((stop) => stop.type === "delivery")
                  .sort((a, b) => a.stop_order - b.stop_order);

                if (
                  collections.length === 1
                  && deliveries.length === 1
                ) {
                  return null;
                }

                return (
                  <div
                    key={job.id}
                    className="mt-4 rounded-lg border border-line bg-surface-2 p-3"
                  >
                    <div className="mb-2 text-sm font-semibold text-ink">
                      {job.reference ?? job.id}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      {collections.length !== 1 ? (
                        <label className="grid gap-1 text-xs text-ink-2">
                          Collection address
                          <select
                            value={
                              stopSelections[job.id]?.collectionId
                              ?? ""
                            }
                            onChange={(event) =>
                              updateStop(
                                job.id,
                                "collectionId",
                                event.target.value,
                              )
                            }
                            className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                          >
                            <option value="">
                              Choose collection...
                            </option>
                            {collections.map((stop) => (
                              <option key={stop.id} value={stop.id}>
                                #{stop.stop_order} -{" "}
                                {formatStopAddress(stop)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}

                      {deliveries.length !== 1 ? (
                        <label className="grid gap-1 text-xs text-ink-2">
                          Delivery address
                          <select
                            value={
                              stopSelections[job.id]?.deliveryId
                              ?? ""
                            }
                            onChange={(event) =>
                              updateStop(
                                job.id,
                                "deliveryId",
                                event.target.value,
                              )
                            }
                            className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
                          >
                            <option value="">
                              Choose delivery...
                            </option>
                            {deliveries.map((stop) => (
                              <option key={stop.id} value={stop.id}>
                                #{stop.stop_order} -{" "}
                                {formatStopAddress(stop)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {templateId === "custom" ? (
                <div className="mt-5 rounded-lg border border-line bg-surface-2 p-4">
                  <div className="mb-3 text-sm font-semibold text-ink">
                    Custom template dimensions
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {([
                      ["pageWidthMm", "Page width mm", 1, 0.1],
                      ["pageHeightMm", "Page height mm", 1, 0.1],
                      ["labelWidthMm", "Label width mm", 1, 0.1],
                      ["labelHeightMm", "Label height mm", 1, 0.1],
                      ["columns", "Columns", 1, 1],
                      ["rows", "Rows", 1, 1],
                      ["marginLeftMm", "Left margin mm", 0, 0.1],
                      ["marginTopMm", "Top margin mm", 0, 0.1],
                      ["gapXmm", "Horizontal gap mm", 0, 0.1],
                      ["gapYmm", "Vertical gap mm", 0, 0.1],
                    ] as const).map(([field, label, min, step]) => (
                      <label
                        key={field}
                        className="grid gap-1 text-xs text-ink-2"
                      >
                        {label}
                        {numericInput(
                          customTemplate[field],
                          (value) => updateCustom(field, value),
                          min,
                          step,
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              {blockingErrors.length > 0 ? (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  <div className="font-semibold">
                    Resolve before printing:
                  </div>
                  <ul className="mt-1 list-disc pl-5">
                    {blockingErrors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {printError && blockingErrors.length === 0 ? (
                <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  {printError}
                </div>
              ) : null}

              {!printError ? (
                <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-xs text-ink-2">
                  Print at 100% / Actual Size. Disable browser headers
                  and footers.
                </div>
              ) : null}

              <div className="mt-4 flex justify-end">
                <Button
                  type="button"
                  onClick={printLabels}
                  disabled={Boolean(printError)}
                >
                  Print {batch.labels.length} Box Label
                  {batch.labels.length === 1 ? "" : "s"}
                </Button>
              </div>
            </div>

            <div className="vehicle-label-print-root bg-white">
              {pages.map((page, pageIndex) => (
                <div
                  key={pageIndex}
                  className="vehicle-label-print-page relative bg-white"
                  style={{
                    width: `${selectedTemplate.pageWidthMm}mm`,
                    height: `${selectedTemplate.pageHeightMm}mm`,
                  }}
                >
                  {page.map((label, slotIndex) => {
                    if (!label) {
                      return null;
                    }

                    const row = Math.floor(
                      slotIndex / selectedTemplate.columns,
                    );
                    const column =
                      slotIndex % selectedTemplate.columns;

                    const left =
                      selectedTemplate.marginLeftMm
                      + column * (
                        selectedTemplate.labelWidthMm
                        + selectedTemplate.gapXmm
                      );

                    const top =
                      selectedTemplate.marginTopMm
                      + row * (
                        selectedTemplate.labelHeightMm
                        + selectedTemplate.gapYmm
                      );

                    return (
                      <VehicleBoxLabel
                        key={label.key}
                        label={label}
                        widthMm={selectedTemplate.labelWidthMm}
                        heightMm={selectedTemplate.labelHeightMm}
                        leftMm={left}
                        topMm={top}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function VehicleBoxLabel({
  label,
  widthMm,
  heightMm,
  leftMm,
  topMm,
}: {
  label: VehicleLabel;
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
          JOB {label.jobReference}
        </span>
        <span className="shrink-0">
          BOX {label.boxNumber}/{label.totalJobBoxes}
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
          {formatStopAddress(label.collection)}
        </div>

        <div className="line-clamp-2">
          <strong>TO:</strong>{" "}
          {formatStopAddress(label.delivery)}
        </div>

        {!compact
        && (label.box.sku || label.box.description) ? (
          <div className="truncate">
            <strong>ITEM:</strong>{" "}
            {[label.box.sku, label.box.description]
              .filter(Boolean)
              .join(" - ")}
          </div>
        ) : null}
      </div>

      <div className={compact ? "mt-[0.8mm]" : "mt-[2mm]"}>
        <BarcodeSvg value={label.box.serial} />
        <div
          className="truncate text-center font-mono font-semibold"
          style={{
            fontSize: compact ? "6.5pt" : "9pt",
            lineHeight: 1,
          }}
        >
          {label.box.serial}
        </div>
      </div>
    </article>
  );
}
