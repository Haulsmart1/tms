export function isSquareSandboxReceipt(receiptUrl: string | null | undefined): boolean {
  if (!receiptUrl) return false;

  try {
    const host = new URL(receiptUrl).hostname;
    return host === "squareupsandbox.com" || host.endsWith(".squareupsandbox.com");
  } catch {
    return false;
  }
}
