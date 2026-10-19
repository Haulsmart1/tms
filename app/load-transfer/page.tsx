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
import styles from "./load-transfer.module.css";

type Vehicle = {
  id: string;
  registration: string;
};

type Driver = {
  id: string;
  name: string | null;
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
  return driver.name?.trim() || "Unnamed driver";
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
                "id,name",
              ),
          )
          .eq("active", true)
          .order(
            "name",
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
    const transferTenantId =
      tenant.activeTenantId;

    if (
      !canConfirm
      || !transferTenantId
    ) {
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
            // requireTenant answers 400 to an admin with no
            // header, so name the tenant the vehicles came from.
            headers: {
              "Content-Type":
                "application/json",
              "x-tenant-id":
                transferTenantId,
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
      <main className={`ds font-sans min-h-screen text-ink ${styles.page}`}>
        <div className="mx-auto max-w-4xl">
          <header className={styles.hero}>
            <p className={styles.eyebrow}>TMS WIZARD / FLEET OPERATIONS</p>
            <h1 className={styles.title}>Transfer load</h1>
            <p className={styles.subtitle}>Choose a tenant to load its vehicles and drivers.</p>
          </header>

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
    <main className={`ds font-sans min-h-screen text-ink ${styles.page}`}>
      <div className={`mx-auto grid max-w-6xl gap-6 ${styles.content}`}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>TMS WIZARD <span aria-hidden="true">/</span> FLEET OPERATIONS</p>
          <h1 className={styles.title}>
            Transfer load
          </h1>

          <p className={styles.subtitle}>
            Scan serialized items from one
            vehicle to another. A partial
            load transfer does not
            automatically move the whole
            job or change Planning.
          </p>
          <ol className={styles.steps} aria-label="Transfer workflow">
            <li><span>01</span> Choose vehicles</li>
            <li><span>02</span> Scan each item</li>
            <li><span>03</span> Review & confirm</li>
          </ol>
        </header>

        <MessageBanner tone={tone}>
          {message}
        </MessageBanner>

        <section className={styles.panel} aria-labelledby="transfer-vehicles-title" aria-busy={loading}>
          <p className={styles.sectionLabel}>01 / ROUTE</p>
          <h2 className={styles.panelTitle} id="transfer-vehicles-title">
            Choose the handover
          </h2>
          <p className={styles.panelCopy}>Select the vehicle carrying the items and the vehicle receiving them.</p>

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

          {!loading && vehicles.length < 2 ? (
            <p className={styles.notice}>At least two active vehicles are needed for a transfer. Check this tenant’s vehicle register before continuing.</p>
          ) : null}

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

        <section className={styles.panel} aria-labelledby="transfer-scan-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={styles.sectionLabel}>02 / ITEMS</p>
              <h2 className={styles.panelTitle} id="transfer-scan-title">
                Build your transfer batch
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
                size="lg"
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
              aria-describedby="transfer-scan-help"
              value={manualValue}
              disabled={submitting}
              onChange={(event) =>
                setManualValue(
                  event.target.value,
                )
              }
              placeholder="Scan or enter barcode / serial"
              className={styles.serialInput}
            />

            <Button
              type="submit"
              size="lg"
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
          <p id="transfer-scan-help" className={styles.panelCopy}>
            Scan the item’s barcode, not the job reference. This batch stays on this page until confirmed; leaving or reloading the page loses the unconfirmed batch.
          </p>
        </section>

        <section className={styles.panel} aria-labelledby="transfer-review-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className={styles.sectionLabel}>03 / CONFIRM</p>
              <h2 className={styles.panelTitle} id="transfer-review-title">
                Check before moving custody
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

          <div className={styles.routeSummary}>
            <div><span>From</span><strong>{vehicles.find((vehicle) => vehicle.id === sourceVehicleId)?.registration || "Choose source vehicle"}</strong></div>
            <span className={styles.routeArrow} aria-hidden="true">→</span>
            <div><span>To</span><strong>{vehicles.find((vehicle) => vehicle.id === destinationVehicleId)?.registration || "Choose destination vehicle"}</strong></div>
          </div>

          {scannedValues.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-line p-5 text-sm text-ink-3">
              Your batch is empty. Scan or enter the first item above, then check every serial here before confirming.
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
                      aria-label={`Remove ${value} from this transfer batch`}
                      disabled={submitting}
                      onClick={() =>
                        removeScan(value)
                      }
                      className="min-h-11 rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
              size="lg"
              className="w-full sm:w-auto"
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
