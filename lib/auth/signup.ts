import { SignupValidation, isSignupHoneypotTriggered } from "../validation/signup";

/* Every decision POST /api/signup makes, free of next/server and Supabase so
   vitest can drive it with fakes (mirrors lib/auth/magicLink.ts). The route
   builds `SignupDeps` from real clients and returns whatever this answers.

   Spec: docs/superpowers/specs/2026-09-16-self-serve-signup-design.md.

   ENUMERATION (AUTH-11, the hard stop in the task prompt). A caller must not
   be able to learn whether an address already has an account. So a brand-new
   address, an existing one, a honeypot hit and an over-limit request all
   answer signupSentResponse(), and that body is built in exactly one place.

   ORDER OF SIDE EFFECTS on a new address: createUser (sends nothing), the
   RPC, then the invite email. The email is last, so compensation after an
   RPC failure deletes an account nobody has been told about. */

export type SignupResponse = {
  status: number;
  body: Record<string, unknown>;
};

export const SIGNUP_SENT_MESSAGE = "Check your inbox to finish setting up your account.";

/* The one success body, whatever branch produced it. */
export function signupSentResponse(): SignupResponse {
  return { status: 200, body: { ok: true, message: SIGNUP_SENT_MESSAGE } };
}

/* The one failure body: admin client missing, lookup failed, or the RPC
   failed after the auth user was created (and compensation ran). Constant
   whether or not the compensating delete succeeded. */
export const SIGNUP_FAILED_MESSAGE = "We could not create your account. Please try again in a moment.";

export function signupFailedResponse(): SignupResponse {
  return { status: 500, body: { ok: false, error: SIGNUP_FAILED_MESSAGE } };
}

export function invalidBodyResponse(): SignupResponse {
  return { status: 400, body: { ok: false, error: "Invalid request body." } };
}

export function fieldErrorsResponse(fieldErrors: Record<string, string[] | undefined>): SignupResponse {
  return { status: 400, body: { ok: false, fieldErrors } };
}

export type SignupLogger = {
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

/* Everything with a side effect, injected. Each rejects (throws) on failure;
   the caller decides what a failure means. None of them accepts tenant,
   company or role: those reach the database only as createCompany's own
   arguments (SQL-13). */
export type SignupDeps = {
  /** True when this hit is within the limit. */
  checkIpLimit: (ipKey: string) => Promise<boolean>;
  checkEmailLimit: (email: string) => Promise<boolean>;
  /** Auth user id for the address, or null. */
  findUserIdByEmail: (email: string) => Promise<string | null>;
  /** Whether that auth user has confirmed their email. */
  getUserConfirmed: (userId: string) => Promise<boolean>;
  /** Creates an unconfirmed auth user WITHOUT sending anything; returns its id. */
  createUser: (email: string) => Promise<string>;
  deleteUser: (userId: string) => Promise<void>;
  /** create_company_with_admin; resolves to its outcome text. */
  createCompany: (args: {
    userId: string;
    email: string;
    companyName: string;
    contactName: string;
  }) => Promise<string>;
  /** inviteUserByEmail: sends the invite (works for an existing unconfirmed user). */
  sendInvite: (email: string) => Promise<void>;
  /** signInWithOtp with shouldCreateUser:false, as /api/auth/magic-link does. */
  sendMagicLink: (email: string) => Promise<void>;
  log: SignupLogger;
};

export type SignupRequest = {
  /** The parsed JSON body, whatever shape it has. */
  body: unknown;
  /** The rate-limit key for the caller (leadClientKey on Vercel). */
  ipKey: string;
};

const ACCEPTED_OUTCOMES = new Set(["created", "already_member"]);

function describe(err: unknown): Record<string, unknown> {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; status?: unknown; name?: unknown };
    return { code: e.code ?? null, status: e.status ?? null, name: e.name ?? null };
  }
  return { code: null, status: null, name: null };
}

/* An address that already has an account gets an email that lets them in,
   and no company. Unconfirmed means a signup that never clicked its invite:
   re-send the invite, because a magic link for an unconfirmed user comes out
   as a signup-type confirmation that /auth/confirm rejects. Any failure here
   is logged only; the response must not differ. */
async function handleExistingUser(deps: SignupDeps, userId: string, email: string): Promise<SignupResponse> {
  try {
    const confirmed = await deps.getUserConfirmed(userId);
    if (confirmed) {
      await deps.sendMagicLink(email);
    } else {
      await deps.sendInvite(email);
    }
  } catch (err) {
    deps.log.warn("signup: sign-in email for an existing address not sent", describe(err));
  }
  return signupSentResponse();
}

/* Compensation after a failed RPC. One retry covers a transient GoTrue error.
   If both attempts fail, an unconfirmed auth user with no profile is left
   behind, and every later submit from that address takes the existing-
   unconfirmed branch (invite re-sent, RPC never called), so the customer would
   confirm into the no-tenant screen. That is an operator ticket: log it under
   its own message with the user id so it can be found and deleted. */
async function compensateCreatedUser(deps: SignupDeps, userId: string): Promise<void> {
  try {
    await deps.deleteUser(userId);
    return;
  } catch (err) {
    deps.log.warn("signup: cleanup of new auth user failed, retrying once", { userId, ...describe(err) });
  }
  try {
    await deps.deleteUser(userId);
  } catch (err) {
    deps.log.error("signup: orphaned auth user left behind after failed provisioning", {
      userId,
      ...describe(err),
    });
  }
}

export async function runSignup(deps: SignupDeps, request: SignupRequest): Promise<SignupResponse> {
  // 1. Honeypot, on the raw body, before any parsing work.
  if (isSignupHoneypotTriggered(request.body)) {
    deps.log.warn("signup: honeypot triggered, dropping silently");
    return signupSentResponse();
  }

  // 2. Per-IP limit before validation: the cheapest abuse to stop, and the
  //    constant body keeps a bot from learning it hit the wall.
  if (!(await deps.checkIpLimit(request.ipKey))) {
    deps.log.warn("signup: per-ip limit reached");
    return signupSentResponse();
  }

  // 3. Validation. Field-keyed like request-access; it runs before any lookup,
  //    so a 400 says nothing about accounts.
  const parsed = SignupValidation.safeParse(request.body);
  if (!parsed.success) {
    return fieldErrorsResponse(parsed.error.flatten().fieldErrors);
  }
  const { companyName, contactName, email } = parsed.data;

  // 4. Per-email limit, independent of whether the account exists.
  if (!(await deps.checkEmailLimit(email))) {
    deps.log.warn("signup: per-email limit reached");
    return signupSentResponse();
  }

  // 5. Look the address up. A lookup failure is a 500 on every path (a 503 the
  //    new-address path alone could produce would be an oracle).
  let existingId: string | null;
  try {
    existingId = await deps.findUserIdByEmail(email);
  } catch (err) {
    deps.log.error("signup: user lookup failed", describe(err));
    return signupFailedResponse();
  }

  if (existingId) {
    return handleExistingUser(deps, existingId, email);
  }

  // 6. New address: create the auth user silently.
  let userId: string;
  try {
    userId = await deps.createUser(email);
  } catch (err) {
    // A concurrent signup for the same address may have won the race; if so,
    // continue as the existing-address branch rather than fail.
    let raced: string | null = null;
    try {
      raced = await deps.findUserIdByEmail(email);
    } catch {
      raced = null;
    }
    if (raced) return handleExistingUser(deps, raced, email);
    deps.log.error("signup: auth user creation failed", describe(err));
    return signupFailedResponse();
  }

  // 7. Provision company, tenant, profile in one transaction. On any failure,
  //    compensate: the account this request created must not be left behind.
  let outcome: string | null = null;
  let provisionError: unknown = null;
  try {
    outcome = await deps.createCompany({ userId, email, companyName, contactName });
  } catch (err) {
    provisionError = err;
  }

  if (provisionError !== null || !outcome || !ACCEPTED_OUTCOMES.has(outcome)) {
    deps.log.error("signup: provisioning failed", { ...describe(provisionError), outcome });
    await compensateCreatedUser(deps, userId);
    return signupFailedResponse();
  }

  // 8. The email, last. If it does not go, the account and company exist and
  //    the customer can retry from /signup (existing, unconfirmed) or /login.
  try {
    await deps.sendInvite(email);
  } catch (err) {
    deps.log.error("signup: invite email not sent after provisioning", describe(err));
  }

  return signupSentResponse();
}
