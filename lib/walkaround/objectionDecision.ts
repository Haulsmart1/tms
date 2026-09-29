/*
  Rules for an admin's decision on a driver's objection, shared by
  PATCH /api/walkaround/objections/[id] and app/maintenance/ObjectionDecision.tsx.
  A rejection keeps the vehicle off the road against the driver's word, so it
  must say why; an approval's note stays optional.
*/

export const MIN_REJECTION_NOTE = 3;
export const REJECTION_NOTE_MESSAGE = "Say why you are rejecting the objection (at least 3 characters).";

export function decisionNoteError(decision: "approve" | "reject", note: string | null | undefined): string | null {
  if (decision !== "reject") return null;
  return (note ?? "").trim().length >= MIN_REJECTION_NOTE ? null : REJECTION_NOTE_MESSAGE;
}
