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
  buildManifestCreateItems,
  isCompatibleMasterLoadJob,
  isMasterLoadEligible,
  manifestAssignmentForJobs,
  manifestBoxCount,
  type ManifestUiJob,
} from "../../lib/printing/loadManifestUi";

type Vehicle = {
  id: string;
  registration: string;
};

type Driver = {
  id: string;
  name: string;
};

type CreatedManifest = {
  id: string;
  reference: string;
  barcode: string;
  itemCount: number;
  jobCount: number;
  vehicleId: string;
  driverId: string;
};

type ManifestSnapshot = CreatedManifest & {
  vehicleRegistration: string;
  driverName: string;
  jobReferences: string[];
};

type Props = {
  jobs: ManifestUiJob[];
  vehicles: Vehicle[];
  drivers: Driver[];
  tenantId?: string | null;
};

function MasterBarcode({
  value,
}: {
  value: string;
}) {
  const ref =
    useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    JsBarcode(
      ref.current,
      value,
      {
        format: "CODE128",
        displayValue: false,
        margin: 0,
        height: 80,
        width: 1.5,
      },
    );
  }, [value]);

  return (
    <svg
      ref={ref}
      aria-label={`Master Load barcode ${value}`}
      className="h-[30mm] w-full"
    />
  );
}

export default function MasterLoadBuilder({
  jobs,
  vehicles,
  drivers,
  tenantId,
}: Props) {
  const [
    selectedJobIds,
    setSelectedJobIds,
  ] = useState<Set<string>>(
    () => new Set(),
  );

  const [creating, setCreating] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [
    createdManifest,
    setCreatedManifest,
  ] = useState<ManifestSnapshot | null>(
    null,
  );

  const [printSize, setPrintSize] =
    useState<"a4" | "4x6">("a4");

  const eligibleJobs = useMemo(
    () =>
      jobs.filter(
        isMasterLoadEligible,
      ),
    [jobs],
  );

  const selectedJobs = useMemo(
    () =>
      eligibleJobs.filter((job) =>
        selectedJobIds.has(job.id),
      ),
    [
      eligibleJobs,
      selectedJobIds,
    ],
  );

  const assignment =
    manifestAssignmentForJobs(
      selectedJobs,
    );

  const selectedBoxCount =
    selectedJobs.reduce(
      (total, job) =>
        total + manifestBoxCount(job),
      0,
    );

  const selectedVehicle =
    assignment
      ? vehicles.find(
          (vehicle) =>
            vehicle.id
            === assignment.vehicleId,
        ) ?? null
      : null;

  const selectedDriver =
    assignment
      ? drivers.find(
          (driver) =>
            driver.id
            === assignment.driverId,
        ) ?? null
      : null;

  useEffect(() => {
    const validIds =
      new Set(
        eligibleJobs.map(
          (job) => job.id,
        ),
      );

    setSelectedJobIds(
      (current) => {
        const next =
          new Set(
            [...current].filter(
              (id) =>
                validIds.has(id),
            ),
          );

        if (
          next.size
          === current.size
          && [...next].every(
            (id) =>
              current.has(id),
          )
        ) {
          return current;
        }

        return next;
      },
    );
  }, [eligibleJobs]);

  function toggleJob(
    job: ManifestUiJob,
  ) {
    setMessage("");
    setCreatedManifest(null);

    setSelectedJobIds(
      (current) => {
        const next =
          new Set(current);

        if (next.has(job.id)) {
          next.delete(job.id);
          return next;
        }

        const currentJobs =
          eligibleJobs.filter(
            (candidate) =>
              next.has(candidate.id),
          );

        if (
          !isCompatibleMasterLoadJob(
            job,
            currentJobs,
          )
        ) {
          setMessage(
            "A Master Load can only combine jobs assigned to the same vehicle and driver.",
          );

          return current;
        }

        next.add(job.id);
        return next;
      },
    );
  }

  function selectCompatible() {
    setMessage("");
    setCreatedManifest(null);

    if (
      eligibleJobs.length === 0
    ) {
      return;
    }

    const base =
      selectedJobs[0]
      ?? eligibleJobs[0];

    const compatible =
      eligibleJobs.filter(
        (job) =>
          job.vehicle_id
            === base.vehicle_id
          && job.driver_id
            === base.driver_id,
      );

    setSelectedJobIds(
      new Set(
        compatible.map(
          (job) => job.id,
        ),
      ),
    );
  }

  function clearSelection() {
    setSelectedJobIds(new Set());
    setMessage("");
    setCreatedManifest(null);
  }

  async function createManifest() {
    setMessage("");
    setCreatedManifest(null);

    if (
      selectedJobs.length === 0
    ) {
      setMessage(
        "Select at least one eligible job.",
      );
      return;
    }

    const currentAssignment =
      manifestAssignmentForJobs(
        selectedJobs,
      );

    if (!currentAssignment) {
      setMessage(
        "Selected jobs must use the same vehicle and driver.",
      );
      return;
    }

    let items;

    try {
      items =
        buildManifestCreateItems(
          selectedJobs,
        );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to build Master Load.",
      );
      return;
    }

    setCreating(true);

    try {
      const headers =
        new Headers({
          "content-type":
            "application/json",
        });

      if (tenantId) {
        headers.set(
          "x-tenant-id",
          tenantId,
        );
      }

      const response =
        await fetch(
          "/api/load-manifests",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              vehicleId:
                currentAssignment.vehicleId,
              driverId:
                currentAssignment.driverId,
              items,
            }),
          },
        );

      const body =
        (await response
          .json()
          .catch(() => ({}))) as {
          error?: string;
          manifest?: CreatedManifest;
        };

      if (
        !response.ok
        || !body.manifest
      ) {
        setMessage(
          body.error
          || "Unable to create Master Load.",
        );
        return;
      }

      const vehicle =
        vehicles.find(
          (entry) =>
            entry.id
            === body.manifest!.vehicleId,
        );

      const driver =
        drivers.find(
          (entry) =>
            entry.id
            === body.manifest!.driverId,
        );

      const snapshot:
        ManifestSnapshot = {
          ...body.manifest,
          vehicleRegistration:
            vehicle?.registration
            ?? "Unknown vehicle",
          driverName:
            driver?.name
            ?? "Unknown driver",
          jobReferences:
            selectedJobs.map(
              (job) =>
                job.reference,
            ),
        };

      setCreatedManifest(
        snapshot,
      );

      setMessage(
        `Master Load ${snapshot.reference} created.`,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Master Load error: ${error.message}`
          : "Unable to create Master Load.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            Master Load
          </h2>

          <p className="mt-1 text-xs text-ink-2">
            Combine serialized boxes from
            multiple jobs assigned to the
            same vehicle and driver.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={
              selectCompatible
            }
            disabled={
              eligibleJobs.length
              === 0
            }
          >
            Check compatible
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={
              clearSelection
            }
            disabled={
              selectedJobIds.size
              === 0
            }
          >
            Clear
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {eligibleJobs.length ? (
          eligibleJobs.map(
            (job) => {
              const checked =
                selectedJobIds.has(
                  job.id,
                );

              const compatible =
                isCompatibleMasterLoadJob(
                  job,
                  selectedJobs.filter(
                    (selected) =>
                      selected.id
                      !== job.id,
                  ),
                );

              const vehicle =
                vehicles.find(
                  (entry) =>
                    entry.id
                    === job.vehicle_id,
                );

              const driver =
                drivers.find(
                  (entry) =>
                    entry.id
                    === job.driver_id,
                );

              return (
                <label
                  key={job.id}
                  className="flex items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={
                      !checked
                      && !compatible
                    }
                    onChange={() =>
                      toggleJob(job)
                    }
                  />

                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm font-semibold text-ink">
                      {job.reference}
                    </div>

                    <div className="mt-0.5 text-xs text-ink-3">
                      {vehicle?.registration
                        ?? "No vehicle"}
                      {" · "}
                      {driver?.name
                        ?? "No driver"}
                      {" · "}
                      {manifestBoxCount(
                        job,
                      )}{" "}
                      box
                      {manifestBoxCount(
                        job,
                      ) === 1
                        ? ""
                        : "es"}
                    </div>
                  </div>
                </label>
              );
            },
          )
        ) : (
          <div className="rounded-md border border-line bg-surface-2 p-3 text-sm text-ink-3">
            No assigned jobs with
            serialized boxes are
            available for a Master
            Load.
          </div>
        )}
      </div>

      <div className="mt-4 rounded-md border border-line bg-surface-2 p-3">
        <div className="grid gap-1 text-sm text-ink">
          <div>
            Selected jobs:{" "}
            <strong>
              {selectedJobs.length}
            </strong>
          </div>

          <div>
            Serialized boxes:{" "}
            <strong>
              {selectedBoxCount}
            </strong>
          </div>

          <div>
            Vehicle:{" "}
            <strong>
              {selectedVehicle
                ?.registration
                ?? "-"}
            </strong>
          </div>

          <div>
            Driver:{" "}
            <strong>
              {selectedDriver
                ?.name
                ?? "-"}
            </strong>
          </div>
        </div>

        <div className="mt-3">
          <Button
            type="button"
            onClick={
              createManifest
            }
            disabled={
              creating
              || selectedJobs.length
                === 0
              || !assignment
              || selectedBoxCount
                === 0
            }
          >
            {creating
              ? "Creating..."
              : `Create Master Load (${selectedBoxCount})`}
          </Button>
        </div>
      </div>

      {message ? (
        <div className="mt-3 rounded-md border border-line bg-surface p-3 text-sm text-ink">
          {message}
        </div>
      ) : null}

      {createdManifest ? (
        <MasterLoadPrintCard
          manifest={
            createdManifest
          }
          printSize={
            printSize
          }
          onPrintSizeChange={
            setPrintSize
          }
        />
      ) : null}
    </section>
  );
}

function MasterLoadPrintCard({
  manifest,
  printSize,
  onPrintSizeChange,
}: {
  manifest: ManifestSnapshot;
  printSize: "a4" | "4x6";
  onPrintSizeChange: (
    value: "a4" | "4x6",
  ) => void;
}) {
  const isA4 =
    printSize === "a4";

  const pageWidthMm =
    isA4 ? 210 : 101.6;

  const pageHeightMm =
    isA4 ? 297 : 152.4;

  function printManifest() {
    window.print();
  }

  return (
    <div className="mt-5">
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden !important;
          }

          .master-load-print-root,
          .master-load-print-root * {
            visibility: visible !important;
          }

          .master-load-print-root {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            margin: 0 !important;
          }

          .master-load-print-controls {
            display: none !important;
          }
        }

        @page {
          size: ${pageWidthMm}mm
            ${pageHeightMm}mm;
          margin: 0;
        }
      `}</style>

      <div className="master-load-print-controls mb-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-ink-2">
          Master card size
          <select
            value={printSize}
            onChange={(event) =>
              onPrintSizeChange(
                event.target.value
                  === "4x6"
                  ? "4x6"
                  : "a4",
              )
            }
            className="rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="a4">
              A4 Master Load
            </option>

            <option value="4x6">
              4 x 6 Master Load
            </option>
          </select>
        </label>

        <Button
          type="button"
          onClick={
            printManifest
          }
        >
          Print Master Load
        </Button>

        <span className="text-xs text-ink-3">
          Print at 100% / Actual
          Size and disable browser
          headers and footers.
        </span>
      </div>

      <article
        className="master-load-print-root box-border bg-white text-black"
        style={{
          width:
            `${pageWidthMm}mm`,
          height:
            `${pageHeightMm}mm`,
          padding:
            isA4
              ? "18mm"
              : "7mm",
          fontFamily:
            "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          className="font-bold uppercase tracking-[0.16em]"
          style={{
            fontSize:
              isA4
                ? "18pt"
                : "11pt",
          }}
        >
          Master Load
        </div>

        <div
          className="mt-[5mm] font-mono font-bold"
          style={{
            fontSize:
              isA4
                ? "34pt"
                : "22pt",
          }}
        >
          {manifest.reference}
        </div>

        <div
          className="mt-[6mm] grid gap-[2mm]"
          style={{
            fontSize:
              isA4
                ? "15pt"
                : "9pt",
          }}
        >
          <div>
            <strong>
              Vehicle:
            </strong>{" "}
            {
              manifest.vehicleRegistration
            }
          </div>

          <div>
            <strong>
              Driver:
            </strong>{" "}
            {manifest.driverName}
          </div>

          <div>
            <strong>
              Jobs:
            </strong>{" "}
            {manifest.jobCount}
          </div>

          <div>
            <strong>
              Boxes:
            </strong>{" "}
            {manifest.itemCount}
          </div>
        </div>

        <div
          className={
            isA4
              ? "mt-[16mm]"
              : "mt-[7mm]"
          }
        >
          <MasterBarcode
            value={
              manifest.barcode
            }
          />
        </div>

        <div
          className="mt-[3mm] break-all text-center font-mono font-semibold"
          style={{
            fontSize:
              isA4
                ? "14pt"
                : "7pt",
          }}
        >
          {manifest.barcode}
        </div>

        <div
          className={
            isA4
              ? "mt-[16mm]"
              : "mt-[7mm]"
          }
        >
          <div
            className="font-bold uppercase"
            style={{
              fontSize:
                isA4
                  ? "12pt"
                  : "8pt",
            }}
          >
            Included Jobs
          </div>

          <div
            className="mt-[2mm] flex flex-wrap gap-x-[4mm] gap-y-[1mm] font-mono"
            style={{
              fontSize:
                isA4
                  ? "11pt"
                  : "7pt",
            }}
          >
            {manifest.jobReferences.map(
              (reference) => (
                <span key={reference}>
                  {reference}
                </span>
              ),
            )}
          </div>
        </div>

        <div
          className={
            isA4
              ? "mt-[18mm]"
              : "mt-[8mm]"
          }
          style={{
            fontSize:
              isA4
                ? "11pt"
                : "7pt",
          }}
        >
          Scan this master barcode
          to record the whole manifest
          ONTO VAN or OFF VAN.
          Individual box barcodes remain
          available for item-level
          verification and exceptions.
        </div>
      </article>
    </div>
  );
}
