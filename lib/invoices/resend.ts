/*
  Re-sending an invoice that has already been emailed (INV-25 UI).

  A second send gives the customer a duplicate, so the page asks first and
  names when it was last sent. The date is shown on the operator's clock
  (Europe/London), in a fixed dd/mm/yyyy HH:mm shape so it does not depend on
  the browser's ICU month names.
*/

import { OPERATOR_TIME_ZONE } from "../time";

export function formatSentAt(sentAt: string | null | undefined, timeZone: string = OPERATOR_TIME_ZONE): string | null {
  if (!sentAt) return null;
  const date = new Date(sentAt);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} at ${get("hour")}:${get("minute")}`;
}

/** The sentence to put in front of the send confirmation, or null when the invoice was never sent. */
export function invoiceResendWarning(input: {
  invoiceNumber: string | null | undefined;
  status: string | null | undefined;
  sentAt: string | null | undefined;
}): string | null {
  if (String(input.status ?? "").trim().toLowerCase() !== "sent") return null;
  const label = input.invoiceNumber || "This invoice";
  const when = formatSentAt(input.sentAt);
  return `${label} was already emailed${when ? ` on ${when}` : ""}. Sending again gives the customer a duplicate.`;
}
