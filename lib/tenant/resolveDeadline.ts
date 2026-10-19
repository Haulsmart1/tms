/** Bounds the UI's wait, not the underlying SDK operation. A timed-out Auth
 * request may still finish internally; never clear cookies or driver queues. */
export const TENANT_RESOLVE_STEP_TIMEOUT_MS = 15_000;

export async function withTenantResolveDeadline<T>(
  operation: PromiseLike<T>,
  timeoutMs = TENANT_RESOLVE_STEP_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Account lookup timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
