import Link from "next/link";
import SignupForm from "./SignupForm";
import { SIGNUP_ENABLED_ENV, signupEnabled } from "../../lib/auth/signupGate";

/* Server component so the kill switch (lib/auth/signupGate.ts) is read here,
   on the server, and never bundled. Rendered on every request rather than at
   build time so flipping SIGNUP_ENABLED in Vercel needs a redeploy but not a
   code change. The form itself is app/signup/SignupForm.tsx, unchanged.

   The closed notice is the real gate's shadow, not the gate: POST /api/signup
   refuses on the same variable whatever page the request came from. */

export const dynamic = "force-dynamic";

export default function SignupPage() {
  if (signupEnabled(process.env[SIGNUP_ENABLED_ENV])) return <SignupForm />;
  return <SignupClosed />;
}

function SignupClosed() {
  return (
    <div className="ds grid min-h-screen place-items-center bg-canvas px-4 py-8 font-sans text-ink">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm">
        {/* Explicit `underline`, as on /login: the .ds reset strips the UA
            underline from anchors, so a link has to opt back in. */}
        <Link href="/" className="text-sm text-ink-2 underline hover:text-ink">
          Back to home
        </Link>

        <h1 className="mt-2 text-xl font-semibold text-ink">Sign-ups are not open yet</h1>
        <p className="mt-2 text-sm text-ink-2">
          We are onboarding operators by invitation for now. Leave your details and we will be in
          touch when your account is ready.
        </p>

        <p className="mt-4 text-sm">
          <Link href="/#request-access" className="underline hover:text-ink">
            Request access
          </Link>
        </p>

        <p className="mt-4 text-xs text-ink-3">
          Already have an account?{" "}
          <Link href="/login" className="underline hover:text-ink">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
