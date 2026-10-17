"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import AuthSurface from "../../components/landing/AuthSurface";
import Field from "../../components/Field";
import Button from "../../components/Button";
import { loginErrorMessage } from "../../lib/auth/loginError";

/* AuthSurface provides the public brand. Login recovery and destination
   handling remain independent of its presentation. */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  /* The deep link the proxy (or TenantGate) sent us here with. The server
     re-validates it against its own origin, so this is never trusted as-is. */
  const [next, setNext] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(params.get("next"));

    // Legacy provider redirects can carry errors in the URL fragment.
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setMessage(loginErrorMessage(params.get("error") ?? fragment.get("error_code") ?? fragment.get("error")));
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setMessage("");
    const trimmed = email.trim();
    if (!trimmed) {
      setMessage("Please enter your email address.");
      return;
    }

    setLoading(true);
    try {
      /* Server route, not supabase.auth.signInWithOtp from the browser: the
         route never creates an account, rate limits, and answers the same
         whether or not the address exists (AUTH-7). */
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, next }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        setMessage(payload.error ?? "Unable to start login. Please try again.");
        return;
      }
      setMessage(payload.message ?? "Check your email for a sign-in link.");
    } catch {
      setMessage("Unable to start login. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthSurface>
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm">
        {/* Explicit `underline`: the .ds reset strips the UA underline from all
            anchors, so a link that should read AS a link has to opt back in.
            Without it this rendered as plain grey text with no affordance. */}
        <Link href="/" className="text-sm text-ink-2 underline hover:text-ink">
          Back to home
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-ink-2">We&apos;ll email you a magic link.</p>
        <p className="mt-2 text-xs text-ink-3">Each link works once. To sign in again or use another browser, request a new login link with your existing account email.</p>

        <form onSubmit={handleLogin} className="mt-4 grid gap-4" noValidate>
          <Field
            id="email"
            name="email"
            type="email"
            label="Email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" size="lg" loading={loading}>
            Send login link
          </Button>
        </form>

        {message ? (
          <div className="mt-4 space-y-3 text-sm text-ink-2">
            <p role="status" aria-live="polite">{message}</p>
            <p>
              No email? Delivery can be temporarily limited. Avoid repeatedly
              requesting links. If it still does not arrive, contact{" "}
              <a className="underline" href="mailto:support@tmswizard.com?subject=TMS%20sign-in%20email%20not%20received">
                support@tmswizard.com
              </a>{" "}
              with the time you tried. Never send your login link or password.
            </p>
          </div>
        ) : null}

        <p className="mt-4 text-xs text-ink-3">
          Need an account?{" "}
          <Link href="/contact" className="underline hover:text-ink">
            Request access
          </Link>
        </p>
      </div>
    </AuthSurface>
  );
}
