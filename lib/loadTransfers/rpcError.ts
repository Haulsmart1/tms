import {
  isUnlicensedVehicleError,
  unlicensedVehicleMessage,
} from "../billing/unlicensedVehicle";

/*
  Turns an error from the create_and_confirm_load_transfer RPC into what the
  caller sees (review S-12). Only sentences this repo's own SQL raises
  (docs/sql/20260930150000_load_transfers_and_stop_windows.sql) are passed
  through, and only under the SQLSTATE they are raised with. A genuine
  constraint violation under the same SQLSTATE carries Postgres text with
  constraint and table names, so it gets fixed copy instead and is logged.
  Pure: the route turns the result into an ApiError.
*/

export type LoadTransferRpcErrorResult = {
  status: number;
  message: string;
  /** True when the raw error should be logged server-side because its text was withheld. */
  log: boolean;
};

const GENERIC_MESSAGE = "Unable to transfer load.";

/** RAISE text in the RPC, keyed by the SQLSTATE it is raised with. Must change with the SQL. */
const KNOWN_REFUSALS: Record<string, readonly string[]> = {
  "22023": [
    "Transfer identity fields are required.",
    "A load transfer requires at least one serialized item.",
    "A load transfer cannot contain more than 1000 serialized items.",
    "Transfer contains an invalid job or item identifier.",
    "Transfer item payload could not be parsed completely.",
    "Every transfer item requires a valid serial number.",
  ],
  "23503": [
    "Source vehicle does not belong to this tenant.",
    "Destination vehicle does not belong to this tenant.",
    "Destination driver does not belong to this tenant.",
  ],
  "23505": ["Transfer contains a duplicate serialized item."],
  "23514": [
    "Source and destination vehicles must differ.",
    "A serial does not belong to its supplied tenant, job or job item.",
    "One or more items are not physically recorded on the source vehicle.",
  ],
};

/** Raised when the custody update raced another write. Reworded because the RAISE text means nothing to a user. */
const CUSTODY_RACE_MESSAGE = "The load changed while it was being transferred. Try again.";

const FALLBACK_BY_CODE: Record<string, { status: number; message: string }> = {
  "22023": { status: 400, message: "Invalid load transfer request." },
  "23503": { status: 409, message: "A vehicle, driver or job in this transfer was not found in this tenant." },
  "23505": { status: 409, message: "This transfer conflicts with an existing record." },
  "23514": { status: 409, message: "This transfer is not allowed for the scanned items." },
  "40001": { status: 409, message: CUSTODY_RACE_MESSAGE },
};

export function loadTransferRpcError(error: {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
}): LoadTransferRpcErrorResult {
  if (isUnlicensedVehicleError(error)) {
    return { status: 409, message: unlicensedVehicleMessage(error), log: false };
  }

  const code = String(error.code ?? "");
  const text = String(error.message ?? "").trim();

  /* prodfix_96 STEP 9: the destination vehicle is VOR. The sentence names
     only a registration in the caller's own tenant, so it is passed through. */
  if (code === "LTR01") {
    return { status: 409, message: text || "The destination vehicle is off the road.", log: false };
  }

  if (code === "40001" && text === "Transfer custody update was incomplete.") {
    return { status: 409, message: CUSTODY_RACE_MESSAGE, log: false };
  }

  const fallback = FALLBACK_BY_CODE[code];
  if (!fallback) {
    return { status: 500, message: GENERIC_MESSAGE, log: true };
  }

  if ((KNOWN_REFUSALS[code] ?? []).includes(text)) {
    return { status: fallback.status, message: text, log: false };
  }

  return { status: fallback.status, message: fallback.message, log: true };
}
