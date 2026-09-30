"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import Button from "../../components/Button";
import MessageBanner, {
  type BannerTone,
} from "../../components/MessageBanner";
import Select from "../../components/Select";
import { normalizeScannedSerial } from "../../lib/driver/barcode";
import { createClient } from "../../lib/supabase/browser";
import CameraScanner, {
  type ScannerCopy,
} from "../driver/CameraScanner";
import TenantGate from "../components/TenantGate";
import { useTenant } from "../components/TenantProvider";

type Vehicle = {
  id: string;
  registration: string;
};

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

type TransferResponse = {
  ok: true;
  transfer: {
    id: string;
    sourceVehicleId: string;
    destinationVehicleId: string;
    destinationDriverId: string | null;
    itemCount: number;
    affectedJobCount: number;
    fullyMovedJobCount: number;
    confirmedAt: string;
  };
};

const SCANNER_COPY: ScannerCopy = {
  open: "Scan with camera",
  title: "Load transfer scanner",
  aim: "Point the rear camera at the item barcode.",
  scanning: "Scanning for a barcode...",
  checking: "Barcode detected. Adding to transfer...",
  manualEntry: "barcode or serial number",
  footer:
    "Each scan moves only that physical serialized item. Jobs are not automatically reassigned.",
};

function driverName(driver: Driver): string {
  const name = [
    driver.first_name,
    driver.last_name,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name || "Unnamed driver";
}

function responseError(
  value: unknown,
): string {
  if (
    typeof value === "object"
    && value !== null
    && "error" in value
    && typeof value.error === "string"
  ) {
    return value.error;
  }

  return "Unable to transfer load.";
}

function LoadTransferPageContent() {
  const tenant = useTenant();
  const supabase = useMemo(
    () => createClient(),
    [],
  );

  const [
    vehicles,
    setVehicles,
  ] = useState<Vehicle[]>([]);

  const [
    drivers,
    setDrivers,
  ] = useState<Driver[]>([]);

  const [
    sourceVehicleId,
    setSourceVehicleId,
  ] = useState("");

  const [
    destinationVehicleId,
    setDestinationVehicleId,
  ] = useState("");

  const [
    destinationDriverId,
    setDestinationDriverId,
  ] = useState("");

  const [
    manualValue,
    setManualValue,
  ] = useState("");

  const [
    scannedValues,
    setScannedValues,
  ] = useState<string[]>([]);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    submitting,
    setSubmitting,
  ] = useState(false);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    tone,
    setTone,
  ] = useState<BannerTone>("neutral");

  const loadSequence = useRef(0);

  const canConfigure =
    tenant.status === "ready"
    && Boolean(tenant.activeTenantId);

  const canConfirm =
    canConfigure
    && !loading
    && !submitting
    && Boolean(sourceVehicleId)
    && Boolean(destinationVehicleId)
    && sourceVehicleId !== destinationVehicleId
    && scannedValues.length > 0;

  const destinationVehicles =
    vehicles.filter(
      (vehicle) =>
        vehicle.id !== sourceVehicleId,
    );

  useEffect(() => {
    if (
      tenant.status !== "ready"
      || !tenant.activeTenantId
    ) {
      setLoading(false);
      setVehicles([]);
      setDrivers([]);
      return;
    }

    const sequence =
      ++loadSequence.current;

    setLoading(true);
    setMessage("");

    void (async () => {
      const [
        vehicleResult,
        driverResult,
      ] = await Promise.all([
        tenant
          .filterByTenant(
            supabase
              .from("vehicles")
              .select(
                "id,registration",
              ),
          )
          .eq("active", true)
          .order(
            "registration",
            {
              ascending: true,
            },
          ),
        tenant
          .filterByTenant(
            supabase
              .from("drivers")
              .select(
                "id,first_name,last_name",
              ),
          )
          .order(
            "last_name",
            {
              ascending: true,
            },
          ),
      ]);

      if (
        sequence
        !== loadSequence.current
      ) {
        return;
      }

      if (vehicleResult.error) {
        setVehicles([]);
        setDrivers([]);
        setTone("danger");
        setMessage(
          vehicleResult.error.message,
        );
        setLoading(false);
        return;
      }

      if (driverResult.error) {
        setVehicles([]);
        setDrivers([]);
        setTone("danger");
        setMessage(
          driverResult.error.message,
        );
        setLoading(false);
        return;
      }

      const loadedVehicles =
        (vehicleResult.data ?? []) as Vehicle[];

      setVehicles(loadedVehicles);

      const loadedDrivers =
        (driverResult.data ?? []) as Driver[];

      setDrivers(loadedDrivers);

      setLoading(false);
    })();
  }, [
    supabase,
    tenant.status,
    tenant.activeTenantId,
  ]);

  useEffect(() => {
    if (
      destinationVehicleId
      && destinationVehicleId
        === sourceVehicleId
    ) {
      setDestinationVehicleId("");
    }
  }, [
    sourceVehicleId,
    destinationVehicleId,
  ]);

  const addScan = useCallback(
    (
      rawValue: string,
    ): {
      ok: boolean;
      message: string;
    } => {
      const normalized =
        normalizeScannedSerial(
          rawValue,
        );

      if (!normalized.ok) {
        setTone("danger");
        setMessage(
          normalized.message,
        );

        return {
          ok: false,
          message:
            normalized.message,
        };
      }

      if (
        scannedValues.includes(
          normalized.value,
        )
      ) {
        const duplicateMessage =
          `Already scanned: ${normalized.value}`;

        setTone("warning");
        setMessage(
          duplicateMessage,
        );

        return {
          ok: false,
          message:
            duplicateMessage,
        };
      }

      setScannedValues(
        (current) => [
          ...current,
          normalized.value,
        ],
      );

      const successMessage =
        `Added ${normalized.value}.`;

      setTone("success");
      setMessage(successMessage);

      return {
        ok: true,
        message:
          successMessage,
      };
    },
    [scannedValues],
  );

  const cameraScan =
    useCallback(
      async (
        value: string,
      ) => addScan(value),
      [addScan],
    );

  function submitManualScan(
    event: FormEvent,
  ) {
    event.preventDefault();

    const result =
      addScan(manualValue);

    if (result.ok) {
      setManualValue("");
    }
  }

  function removeScan(
    value: string,
  ) {
    setScannedValues(
      (current) =>
        current.filter(
          (scan) =>
            scan !== value,
        ),
    );

    setTone("neutral");
    setMessage(
      `Removed ${value}.`,
    );
  }

  function clearBatch() {
    setScannedValues([]);
    setManualValue("");
    setTone("neutral");
    setMessage(
      "Transfer batch cleared.",
    );
  }

  async function confirmTransfer() {
    if (!canConfirm) {
      return;
    }

    setSubmitting(true);
    setTone("info");
    setMessage(
      "Transferring load...",
    );

    try {
      const response =
        await fetch(
          "/api/load-transfers",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              sourceVehicleId,
              destinationVehicleId,
              destinationDriverId:
                destinationDriverId
                || null,
              scannedValues,
            }),
          },
        );

      const body: unknown =
        await response
          .json()
          .catch(
            () => null,
          );

      if (!response.ok) {
        throw new Error(
          responseError(body),
        );
      }

      const result =
        body as TransferResponse;

      const transferred =
        result.transfer;

      setScannedValues([]);
      setManualValue("");
      setTone("success");
      setMessage(
        `${transferred.itemCount} item${
          transferred.itemCount === 1
            ? ""
            : "s"
        } transferred. ${
          transferred.affectedJobCount
        } job${
          transferred.affectedJobCount === 1
            ? ""
            : "s"
        } affected; ${
          transferred.fullyMovedJobCount
        } fully moved.`,
      );
    } catch (error) {
      setTone("danger");
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to transfer load.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (
    tenant.status === "ready"
    && !tenant.activeTenantId
  ) {
    return (
      <main className="ds min-h-screen bg-canvas p-6 text-ink">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-semibold">
            Transfer load
          </h1>

          <MessageBanner
            tone="warning"
            className="mt-4"
          >
            Select a company before
            transferring load. Load
            transfers cannot be performed
            while viewing all tenants.
          </MessageBanner>
        </div>
      </main>
    );
  }

  return (
    <main className="ds min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto grid max-w-5xl gap-6">
        <header>
          <h1 className="text-2xl font-semibold">
            Transfer load
          </h1>

          <p className="mt-1 text-sm text-ink-3">
            Scan serialized items from one
            vehicle to another. A partial
            load transfer does not
            automatically move the whole
            job or change Planning.
          </p>
        </header>

        <MessageBanner tone={tone}>
          {message}
        </MessageBanner>

        <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
          <h2 className="text-lg font-semibold">
            Vehicles
          </h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Select
              id="transfer-source"
              label="From vehicle"
              value={sourceVehicleId}
              disabled={
                loading
                || submitting
              }
              onChange={(event) =>
                setSourceVehicleId(
                  event.target.value,
                )
              }
            >
              <option value="">
                {loading
                  ? "Loading vehicles..."
                  : "Select source vehicle"}
              </option>

              {vehicles.map(
                (vehicle) => (
                  <option
                    key={vehicle.id}
                    value={vehicle.id}
                  >
                    {vehicle.registration}
                  </option>
                ),
              )}
            </Select>

            <Select
              id="transfer-destination"
              label="To vehicle"
              value={
                destinationVehicleId
              }
              disabled={
                loading
                || submitting
                || !sourceVehicleId
              }
              onChange={(event) =>
                setDestinationVehicleId(
                  event.target.value,
                )
              }
            >
              <option value="">
                Select destination vehicle
              </option>

              {destinationVehicles.map(
                (vehicle) => (
                  <option
                    key={vehicle.id}
                    value={vehicle.id}
                  >
                    {vehicle.registration}
                  </option>
                ),
              )}
            </Select>

            <Select
              id="transfer-driver"
              label="Destination driver"
              hint="Optional. This records physical custody only; it does not change the driver's shift."
              value={
                destinationDriverId
              }
              disabled={
                loading
                || submitting
              }
              onChange={(event) =>
                setDestinationDriverId(
                  event.target.value,
                )
              }
            >
              <option value="">
                No driver selected
              </option>

              {drivers.map(
                (driver) => (
                  <option
                    key={driver.id}
                    value={driver.id}
                  >
                    {driverName(driver)}
                  </option>
                ),
              )}
            </Select>
          </div>

          {sourceVehicleId
          && destinationVehicleId
          && sourceVehicleId
            === destinationVehicleId ? (
            <p className="mt-3 text-sm text-danger-strong">
              Source and destination
              vehicles must be different.
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Scan load
              </h2>

              <p className="mt-1 text-sm text-ink-3">
                {scannedValues.length} item
                {scannedValues.length === 1
                  ? ""
                  : "s"}{" "}
                in this transfer batch.
              </p>
            </div>

            {scannedValues.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={clearBatch}
              >
                Clear batch
              </Button>
            ) : null}
          </div>

          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={submitManualScan}
          >
            <label
              htmlFor="transfer-serial"
              className="sr-only"
            >
              Barcode or serial number
            </label>

            <input
              id="transfer-serial"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={manualValue}
              disabled={submitting}
              onChange={(event) =>
                setManualValue(
                  event.target.value,
                )
              }
              placeholder="Scan or enter barcode / serial"
              className="h-10 min-w-0 flex-1 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
            />

            <Button
              type="submit"
              disabled={
                submitting
                || !manualValue.trim()
              }
            >
              Add scan
            </Button>
          </form>

          <CameraScanner
            mode="barcode"
            copy={SCANNER_COPY}
            disabled={submitting}
            onScan={cameraScan}
          />
        </section>

        <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                Review transfer
              </h2>

              <p className="mt-1 text-sm text-ink-3">
                Only the serialized items
                listed below will move.
              </p>
            </div>

            <span className="rounded-full border border-line bg-canvas px-3 py-1 text-sm font-semibold">
              {scannedValues.length} scanned
            </span>
          </div>

          {scannedValues.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-line p-5 text-sm text-ink-3">
              No items scanned yet.
            </p>
          ) : (
            <ol className="mt-4 grid gap-2">
              {scannedValues.map(
                (value, index) => (
                  <li
                    key={value}
                    className="flex min-w-0 items-center gap-3 rounded-lg border border-line bg-canvas p-3"
                  >
                    <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-primary-tint text-xs font-semibold text-primary-deep">
                      {index + 1}
                    </span>

                    <code className="min-w-0 flex-1 break-all text-sm">
                      {value}
                    </code>

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() =>
                        removeScan(value)
                      }
                      className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ),
              )}
            </ol>
          )}

          <div className="mt-5 border-t border-line pt-5">
            <Button
              type="button"
              loading={submitting}
              disabled={!canConfirm}
              onClick={confirmTransfer}
            >
              Confirm transfer
            </Button>

            {!sourceVehicleId ? (
              <p className="mt-2 text-xs text-ink-3">
                Select the source vehicle
                before confirming.
              </p>
            ) : !destinationVehicleId ? (
              <p className="mt-2 text-xs text-ink-3">
                Select the destination
                vehicle before confirming.
              </p>
            ) : scannedValues.length === 0 ? (
              <p className="mt-2 text-xs text-ink-3">
                Scan at least one item
                before confirming.
              </p>
            ) : (
              <p className="mt-2 text-xs text-ink-3">
                Confirmation is atomic:
                if any item is invalid or
                is no longer on the source
                vehicle, the batch will not
                be transferred.
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function LoadTransferPage() {
  return (
    <TenantGate>
      <LoadTransferPageContent />
    </TenantGate>
  );
}