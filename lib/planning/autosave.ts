/*
  Autosave retry policy (review PLAN-7).

  Autosave used to re-arm itself every ~1.2 s after a failure, forever, because
  the effect depended on `saving` and the unsaved work was still there. A
  persistent failure (RLS denial, missing migration, expired session, offline)
  sent the whole diff to Supabase about once a second for as long as the tab
  was open.

  Now a failure is recorded against the snapshot of work that failed:
    - the same snapshot retries with exponential backoff (2.4 s, 4.8 s, ...);
    - after AUTOSAVE_MAX_RETRIES retries, or at once for a non-retryable
      failure (conflict, missing RPC), autosave stops and the error stays
      visible;
    - any new edit changes the snapshot, which resumes normal autosave.
*/

export const AUTOSAVE_DEBOUNCE_MS = 1200;
export const AUTOSAVE_MAX_RETRIES = 4;
export const AUTOSAVE_MAX_DELAY_MS = 60_000;

export type AutosaveFailure = {
  snapshot: string;
  failures: number;
  retryable: boolean;
};

export function recordAutosaveFailure(
  previous: AutosaveFailure | null,
  snapshot: string,
  retryable: boolean
): AutosaveFailure {
  const failures =
    previous && previous.snapshot === snapshot ? previous.failures + 1 : 1;

  return { snapshot, failures, retryable };
}

/** Milliseconds until the next autosave attempt, or null when autosave must wait for a new edit. */
export function autosaveDelay(
  snapshot: string,
  failure: AutosaveFailure | null
): number | null {
  if (!failure || failure.snapshot !== snapshot) {
    return AUTOSAVE_DEBOUNCE_MS;
  }

  if (!failure.retryable || failure.failures > AUTOSAVE_MAX_RETRIES) {
    return null;
  }

  return Math.min(
    AUTOSAVE_MAX_DELAY_MS,
    AUTOSAVE_DEBOUNCE_MS * 2 ** failure.failures
  );
}
