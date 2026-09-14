/*
  Error handling for the accounts, customers and portal API routes (review ACC-15).

  Rule: a client only ever sees text we wrote. Database, Xero, Microsoft Graph
  and environment error text is logged server-side with a short reference and
  replaced by a generic message plus a stable `code`, so probing malformed ids
  or dates no longer reveals table, column, constraint or env-var names.

  Throw AccountsHttpError for anything the user should read (validation,
  conflicts, "not found"); throw a plain Error for everything else.
*/

export class AccountsHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = "request_failed",
  ) {
    super(message);
  }
}

export type ErrorResponse = {
  status: number;
  body: { error: string; code: string; ref?: string };
};

export const GENERIC_ERROR_MESSAGE =
  "Something went wrong. Please try again, or contact support quoting the reference.";

function newRef(): string {
  return Math.random().toString(36).slice(2, 10) || "0";
}

/**
  Maps a thrown value to a safe HTTP response. `log` receives the original error
  and the reference so the server log can be matched to what the user reports.
*/
export function toErrorResponse(
  error: unknown,
  log: (ref: string, error: unknown) => void = (ref, err) =>
    console.error(`[api] unexpected error ref=${ref}`, err),
): ErrorResponse {
  if (error instanceof AccountsHttpError) {
    return { status: error.status, body: { error: error.message, code: error.code } };
  }

  const message = error instanceof Error ? error.message : "";

  if (message === "UNAUTHENTICATED") {
    return { status: 401, body: { error: "You must be signed in.", code: "unauthenticated" } };
  }

  if (message === "FORBIDDEN") {
    return { status: 403, body: { error: "You do not have access to this tenant.", code: "forbidden" } };
  }

  const ref = newRef();
  log(ref, error);
  return { status: 500, body: { error: GENERIC_ERROR_MESSAGE, code: "internal_error", ref } };
}

/** Postgres "undefined function" and PostgREST "function not in schema cache". */
const MISSING_FUNCTION_CODES = new Set(["42883", "PGRST202"]);

export function isMissingFunctionError(error: { code?: string | null } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_FUNCTION_CODES.has(error.code));
}

/**
  The refusal used when a route depends on a prodfix migration that has not been
  applied. It is deliberately a clear failure, never a fallback to the old
  non-atomic path, because the old path is what could double-invoice or
  over-allocate money.
*/
export function migrationRequired(sqlFile: string): AccountsHttpError {
  console.error(`[accounts] database function missing; apply docs/sql/${sqlFile}`);
  return new AccountsHttpError(
    503,
    "This action is unavailable until a pending database update is applied. Please contact support.",
    "migration_required",
  );
}

/**
  Our SECURITY DEFINER functions raise stable snake_case codes as the exception
  message. Returns the code when it is one of `known`, otherwise null (so an
  unexpected database error is never echoed).
*/
export function rpcBusinessCode<T extends string>(
  error: { message?: string | null } | null | undefined,
  known: readonly T[],
): T | null {
  const message = String(error?.message ?? "").trim();
  return (known as readonly string[]).includes(message) ? (message as T) : null;
}
