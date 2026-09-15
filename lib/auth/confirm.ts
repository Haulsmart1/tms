export function safeAuthNextPath(
  raw: string | null,
  origin: string,
): string {
  if (!raw) {
    return "/dashboard";
  }

  try {
    const resolved = new URL(raw, origin);

    if (resolved.origin === origin) {
      return (
        resolved.pathname +
        resolved.search +
        resolved.hash
      );
    }
  } catch {
    // Fall through to the normal dashboard.
  }

  return "/dashboard";
}

export function isValidMagicLinkTokenHash(
  value: string | null,
): value is string {
  if (!value) {
    return false;
  }

  if (value.length > 512) {
    return false;
  }

  return !/\s/.test(value);
}

/* OTP types an emailed link may carry into the scanner-safe confirm page.
   "email" is the magic-link template, "magiclink" is the older alias that
   admin.generateLink (scripts/dev-login.mjs) emits, and "invite" is the
   invite template once it points at /auth/confirm (AUTH-6). recovery and
   email_change are deliberately absent: there are no passwords and no
   email-change flow, so a link of either type is never legitimate here. */
export const CONFIRMABLE_EMAIL_OTP_TYPES = ["email", "magiclink", "invite"] as const;

export type ConfirmableEmailOtpType = (typeof CONFIRMABLE_EMAIL_OTP_TYPES)[number];

export function isMagicLinkEmailType(
  value: string | null,
): value is ConfirmableEmailOtpType {
  return (CONFIRMABLE_EMAIL_OTP_TYPES as readonly string[]).includes(value ?? "");
}
