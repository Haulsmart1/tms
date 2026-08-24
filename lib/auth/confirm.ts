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

export function isMagicLinkEmailType(
  value: string | null,
): value is "email" {
  return value === "email";
}
