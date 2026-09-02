export type ResolveMode = "blocking" | "background" | "skip";

/* A background revalidate costs two Supabase round trips. Tab-switching fires
   an auth event every single time the tab becomes visible, so without this
   floor a user alt-tabbing between the TMS and a spreadsheet would hammer the
   API. Five minutes is short enough that a role or tenant-access change made
   elsewhere still lands promptly. */
export const REVALIDATE_MIN_INTERVAL_MS = 5 * 60 * 1000;

export function decideResolveMode(input: {
  event: string;
  hasReadyContext: boolean;
  currentUserId: string | null;
  eventUserId: string | null;
}): ResolveMode {
  const { event, hasReadyContext, currentUserId, eventUserId } = input;

  if (event === "SIGNED_OUT") return "blocking";
  if (event === "USER_UPDATED") return "background";

  if (event === "SIGNED_IN") {
    /* Nothing on screen to protect yet, so the gate may as well block. */
    if (!hasReadyContext || !currentUserId) return "blocking";
    /* A genuine account switch: the old context is wrong, block and rebuild. */
    if (eventUserId && eventUserId !== currentUserId) return "blocking";
    /* Same user, already resolved: this is auth-js re-emitting SIGNED_IN after
       a visibilitychange. Never block on it. */
    return "background";
  }

  return "skip";
}

export function shouldRevalidate(input: {
  lastResolvedAt: number | null;
  now: number;
  minIntervalMs?: number;
}): boolean {
  const {
    lastResolvedAt,
    now,
    minIntervalMs = REVALIDATE_MIN_INTERVAL_MS,
  } = input;
  if (lastResolvedAt === null) return true;
  return now - lastResolvedAt >= minIntervalMs;
}
