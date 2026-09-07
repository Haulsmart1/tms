// Classifies a throw from the Square SDK into "the payment was refused" or
// "we have no usable answer".
//
// WHY THIS IS NOT IN ./money.ts, where the sibling classifyPaymentResult lives.
// The instanceof tests below need the SDK's error CLASSES at runtime, so this
// module has to `import { SquareError } from "square"`. money.ts is imported by
// client components (app/settings/billing/page.tsx, .../licences/page.tsx,
// NextInvoiceCard.tsx and others) for formatPence/computeChargeAmounts, so an
// SDK import there would drag the Square Node client into the browser bundle.
// This file is therefore separate and is only ever imported from server code.
// It is still pure: no I/O, no env, directly unit tested in ./squareThrow.test.ts.
//
// THE RULE: A THROW IS A DECLINE ONLY ON POSITIVE EVIDENCE THAT SQUARE REFUSED
// THE PAYMENT. Everything else is indeterminate, because "no usable answer" is
// not evidence that no money moved. Recording a non-answer as a decline settles
// the pending audit row, retires the attempt, and lets the customer's next click
// mint a NEW idempotency key, which charges the card a second time for a payment
// Square may have completed perfectly before the connection died.
//
// The previous rule here was the exact inverse (SquareError means declined,
// anything else means indeterminate) and it was wrong about the case that
// actually happens. Read node_modules/square/errors/handleNonStatusCodeError.js:
// its `switch (error.reason)` throws
//
//   "unknown"      -> SquareError with NO statusCode. This is what core/fetcher
//                     produces for a socket reset, a DNS failure or a TLS
//                     error, i.e. exactly the cases the old comment claimed
//                     were caught by the indeterminate branch.
//   "non-json"     -> SquareError with a statusCode and an UNPARSED body.
//   "body-is-null" -> SquareError with a statusCode and no body at all.
//   "timeout"      -> SquareTimeoutError, which does NOT extend SquareError.
//
// So under the old rule a timeout was the ONLY indeterminate case, and a dropped
// connection was reported to the customer as "your card was declined".

import { SquareError, SquareTimeoutError } from "square";

export type SquareThrowClassification =
  | { kind: "declined"; failureCode: string }
  | { kind: "indeterminate"; reason: string };

function trim(text: string): string {
  return text.slice(0, 120);
}

// The parsed error code from Square's own response body, or null when there
// isn't one.
//
// Deliberately NOT `error.errors[0]?.code`. SquareError's constructor
// SYNTHESISES `errors = [{ category: "V1_ERROR", code: "Unknown" }]` whenever
// the body is missing or is not an object, so `errors` is never empty and its
// mere presence proves nothing. The body being a parsed object is the real
// evidence that Square answered with a decision rather than that the SDK
// invented a placeholder. (A V1-shaped body is an object too, and the SDK maps
// its `type` into the code, which is still Square's own answer.)
function parsedFailureCode(error: SquareError): string | null {
  if (error.body === null || typeof error.body !== "object") return null;
  const code = error.errors[0]?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

export function classifySquareThrow(error: unknown): SquareThrowClassification {
  // Checked before SquareError because it is a sibling class, not a subclass:
  // an `instanceof SquareError` test would miss it entirely.
  if (error instanceof SquareTimeoutError) {
    return { kind: "indeterminate", reason: `TIMEOUT: ${trim(error.message)}` };
  }

  if (!(error instanceof SquareError)) {
    // Anything the SDK did not raise: a bug in our own code, an abort signal,
    // a thrown string. None of it tells us what the card did.
    if (error instanceof Error) {
      return {
        kind: "indeterminate",
        reason: `NON_SQUARE_THROW ${error.name}: ${trim(error.message)}`,
      };
    }
    return {
      kind: "indeterminate",
      reason: `NON_ERROR_THROW: ${trim(String(error))}`,
    };
  }

  const status = error.statusCode;

  // The "unknown" reason: the request never got a complete HTTP response.
  // Square may have processed it and lost the reply.
  if (typeof status !== "number") {
    return {
      kind: "indeterminate",
      reason: `NO_STATUS_CODE: ${trim(error.message)}`,
    };
  }

  // Rate limited. The request may have been rejected at the edge, but it may
  // equally have been counted after being accepted; either way Square did not
  // rule on the card.
  if (status === 429) {
    return { kind: "indeterminate", reason: `RATE_LIMITED_${status}` };
  }

  // Square broke, not the card. A 5xx can be raised after the payment was
  // taken.
  if (status >= 500) {
    return { kind: "indeterminate", reason: `SERVER_ERROR_${status}` };
  }

  if (status < 400) {
    // "non-json" and "body-is-null" carry the real status, so a 2xx lands here.
    // A 200 whose body would not parse is very likely a SUCCESSFUL payment we
    // simply could not read.
    return { kind: "indeterminate", reason: `UNREADABLE_RESPONSE_${status}` };
  }

  const failureCode = parsedFailureCode(error);
  if (failureCode === null) {
    // A 4xx with nothing parsed from the body. We know the request was
    // rejected somewhere, but not by what or at what stage, so it is not
    // proof the card was untouched.
    return { kind: "indeterminate", reason: `UNPARSED_BODY_${status}` };
  }

  // 4xx, not 429, with Square's own error code in a parsed body. Square looked
  // at this request and refused it. Terminal, and safe to record as a decline.
  return { kind: "declined", failureCode };
}
