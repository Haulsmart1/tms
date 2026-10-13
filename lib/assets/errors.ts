/* Turns asset write refusals into sentences. Client-safe: the page writes
   through the browser client and the routes share the predicates.

   THE CONTRACT with docs/sql/assets_01 (both sides change together):
     AST01  a browser write touched archived_at / archived_by (server-only)
     AST02  a browser update hit an archived row (restore it first)
     AST03  a browser write moved an asset to another tenant or company
     42501  RLS refused the write (an insert, or an update whose new row fails WITH CHECK):
            the caller is not office staff. assets_01 guards archived_at / archived_by with
            the AST01 trigger ONLY, never with column REVOKEs: a column privilege error is
            also 42501 and fires before the trigger, which would show the office-only
            sentence for the wrong reason. */

export const ASSET_ARCHIVE_GUARD_ERRCODE = "AST01";
export const ASSET_ARCHIVED_ERRCODE = "AST02";
export const ASSET_TENANT_PINNED_ERRCODE = "AST03";

export const ASSET_ARCHIVE_GUARD_MESSAGE =
  "Archive and restore assets with the buttons in the asset window.";
export const ASSET_TENANT_PINNED_MESSAGE = "An asset cannot be moved to another tenant or company.";
export const ASSET_ARCHIVED_MESSAGE = "This asset is archived. Restore it before editing.";
export const ASSET_OFFICE_ONLY_MESSAGE = "Only office staff can add or change assets.";
export const ASSET_DUPLICATE_NUMBER_MESSAGE =
  "Another asset in this tenant already uses that asset number.";
/* An UPDATE that RLS filters out is not an error in Postgres: it matches zero
   rows. The page asks for the updated ids back and shows this when none came. */
export const ASSET_NOT_UPDATED_MESSAGE =
  "This asset was not updated. It may have been removed, or you may not have permission to change it.";

type ErrorLike = { code?: unknown; message?: unknown };

function asErrorLike(error: unknown): ErrorLike | null {
  return error !== null && typeof error === "object" ? (error as ErrorLike) : null;
}

export function assetWriteMessage(error: unknown, fallback = "Unable to save asset."): string {
  const e = asErrorLike(error);
  if (!e) return fallback;
  if (e.code === ASSET_ARCHIVED_ERRCODE) return ASSET_ARCHIVED_MESSAGE;
  if (e.code === ASSET_ARCHIVE_GUARD_ERRCODE) return ASSET_ARCHIVE_GUARD_MESSAGE;
  if (e.code === ASSET_TENANT_PINNED_ERRCODE) return ASSET_TENANT_PINNED_MESSAGE;
  if (e.code === "42501") return ASSET_OFFICE_ONLY_MESSAGE;
  /* The page's duplicate pre-check can lose a race, so the unique index answers instead. */
  if (e.code === "23505") return ASSET_DUPLICATE_NUMBER_MESSAGE;
  return typeof e.message === "string" && e.message ? e.message : fallback;
}

/** 42703 (Postgres) or PGRST204 (PostgREST schema cache): assets_01 is not applied. */
export function isMissingColumnError(error: unknown): boolean {
  const e = asErrorLike(error);
  return e?.code === "42703" || e?.code === "PGRST204";
}

export function isForeignKeyViolation(error: unknown): boolean {
  return asErrorLike(error)?.code === "23503";
}
