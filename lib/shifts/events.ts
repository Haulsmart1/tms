/*
  The events the driver app queues offline and posts one at a time to
  POST /api/driver/shift/events. Every event carries a phone-generated clientId
  (idempotency key) and the time it actually happened. Client-safe: the driver
  app uses the same types to build events.

  Events inside a shift name it by shiftClientId: the client id of the start
  check that opened it (the server exposes it as openShift.clientId, and an
  office-started shift has its own). A late event can then only ever attach
  to its own shift, never to whichever shift happens to be open when it syncs.
*/

import { z } from "zod";

const odometer = z.number().int().min(0).max(9_999_999);

const defectSchema = z.object({
  clientId: z.uuid(),
  catalogueItemId: z.uuid().nullable(),
  driverSeverity: z.enum(["minor", "dangerous"]).nullable(),
  note: z.string().max(1000).nullable(),
});

const base = { clientId: z.uuid(), occurredAt: z.iso.datetime({ offset: true }) };
const inShift = { ...base, shiftClientId: z.uuid() };

export const driverEventSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("check_submitted"),
    phase: z.enum(["start", "swap"]),
    /** Null on a start check (it opens the shift); the open shift on a swap. */
    shiftClientId: z.uuid().nullable(),
    vehicleId: z.uuid(),
    confirmation: z.enum(["qr", "registration"]),
    qrPayload: z.string().max(64).nullable(),
    typedRegistration: z.string().max(16).nullable(),
    mismatchReason: z.string().max(300).nullable(),
    odometer,
    previousEndOdometer: odometer.nullable(),
    declarationAccepted: z.literal(true),
    checklistItemIds: z.array(z.uuid()).min(1).max(500),
    defects: z.array(defectSchema).max(100),
  }),
  z.object({ ...inShift, type: z.literal("break_started") }),
  z.object({ ...inShift, type: z.literal("break_ended") }),
  z.object({ ...inShift, type: z.literal("shift_ended"), odometer, newDefects: z.array(defectSchema).max(100) }),
  z.object({ ...base, type: z.literal("objection_raised"), defectClientId: z.uuid(), reason: z.string().trim().min(3).max(1000) }),
]);

export type DriverEvent = z.infer<typeof driverEventSchema>;
export type CheckSubmittedEvent = Extract<DriverEvent, { type: "check_submitted" }>;
export type QueuedDefect = z.infer<typeof defectSchema>;

export function parseDriverEvent(input: unknown): { ok: true; event: DriverEvent } | { ok: false; error: string } {
  const parsed = driverEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "The event is not valid." };
  const event = parsed.data;
  if (event.type === "check_submitted") {
    if (event.confirmation === "qr" && !event.qrPayload) return { ok: false, error: "Scan the cab QR code." };
    if (event.confirmation === "registration" && !event.typedRegistration?.trim()) return { ok: false, error: "Type the registration." };
    if (event.phase === "swap" && event.shiftClientId === null) return { ok: false, error: "A vehicle swap must name its shift." };
    if (event.phase === "start" && event.shiftClientId !== null) return { ok: false, error: "A start check opens a new shift and cannot name one." };
    if (event.phase === "swap" && event.previousEndOdometer === null) return { ok: false, error: "Enter the odometer of the vehicle you are leaving." };
  }
  return { ok: true, event };
}
