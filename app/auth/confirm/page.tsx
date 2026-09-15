import Link from "next/link";
import {
  isMagicLinkEmailType,
  isValidMagicLinkTokenHash,
} from "../../../lib/auth/confirm";

type SearchParams = Promise<
  Record<
    string,
    string | string[] | undefined
  >
>;

function scalar(
  value: string | string[] | undefined,
): string | null {
  return typeof value === "string"
    ? value
    : null;
}

export default async function AuthConfirmPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;

  const tokenHash =
    scalar(params.token_hash);

  const type =
    scalar(params.type);

  const next =
    scalar(params.next) ??
    "/dashboard";

  /* The link's own OTP type (email, magiclink or invite) is carried through
     rather than forced to "email", so an invite link verifies as an invite.
     The callback re-validates it against the same allowlist. */
  const valid =
    isValidMagicLinkTokenHash(tokenHash) &&
    isMagicLinkEmailType(type);

  return (
    <main className="ds grid min-h-screen place-items-center bg-canvas px-4 font-sans text-ink">
      <section className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm">
        <Link
          href="/"
          className="text-sm text-ink-2 underline hover:text-ink"
        >
          Back to home
        </Link>

        <h1 className="mt-2 text-xl font-semibold text-ink">
          Confirm sign in
        </h1>

        {valid ? (
          <>
            <p className="mt-2 text-sm text-ink-2">
              Press continue to securely sign in to TMS Wizzard.
            </p>

            {/* A sign-in link signs you in as whoever it was sent to. Someone
                could send you a link to THEIR account hoping you enter
                customer or card details into it (login CSRF, AUTH-6). */}
            <p className="mt-2 text-sm text-ink-2">
              Only continue if you asked for this link yourself. If someone
              else sent it to you, close this page.
            </p>

            <form
              method="post"
              action="/api/auth/callback"
              className="mt-5"
            >
              <input
                type="hidden"
                name="token_hash"
                value={tokenHash}
              />

              <input
                type="hidden"
                name="type"
                value={type ?? "email"}
              />

              <input
                type="hidden"
                name="next"
                value={next}
              />

              <button
                type="submit"
                className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-on-primary hover:bg-primary-hover"
              >
                Continue to TMS Wizzard
              </button>
            </form>

            <p className="mt-4 text-xs text-ink-2">
              This extra confirmation protects one-time login links
              from automated email security scanners.
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-2">
              This sign-in link is incomplete or invalid.
            </p>

            <Link
              href="/login"
              className="mt-5 inline-block text-sm font-semibold text-primary-deep underline"
            >
              Request a new login link
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
