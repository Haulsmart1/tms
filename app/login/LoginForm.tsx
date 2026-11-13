"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import AuthSurface from "../../components/landing/AuthSurface";
import Field from "../../components/Field";
import Button from "../../components/Button";
import { readPastedLoginLink } from "../../lib/auth/appLogin";
import { safeAuthNextPath } from "../../lib/auth/confirm";
import { loginErrorMessage } from "../../lib/auth/loginError";
import { useTenant } from "../components/TenantProvider";

/* AuthSurface provides the public brand. Login recovery and destination
   handling remain independent of its presentation. */
export default function LoginForm({ installedApp }: { installedApp?: "driver" | "warehouse" }) {
  const appHome = installedApp === "driver" ? "/driver/dashboard" : installedApp === "warehouse" ? "/warehouse" : null;
  const [pastedLink, setPastedLink] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [handoffPending, setHandoffPending] = useState(false);
  const tenant = useTenant();
  const [email, setEmail] = useState("");
  const [requestedEmail, setRequestedEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  /* The deep link the proxy (or TenantGate) sent us here with. The server
     re-validates it against its own origin, so this is never trusted as-is. */
  const [next, setNext] = useState<string | null>(appHome);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = safeAuthNextPath(params.get("next"), window.location.origin);
    const path = new URL(requested, window.location.origin).pathname;
    const inScope = installedApp === "driver" ? path.startsWith("/driver/") && path !== "/driver/login"
      : path === "/warehouse";
    setNext(appHome ? (inScope ? requested : appHome) : params.get("next"));

    // Legacy provider redirects can carry errors in the URL fragment.
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    setMessage(loginErrorMessage(params.get("error") ?? fragment.get("error_code") ?? fragment.get("error")));
  }, [appHome, installedApp]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    setMessage("");
    setRequestedEmail("");
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
      setRequestedEmail(trimmed);
    } catch {
      setMessage("Unable to start login. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handlePastedLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (handoffPending) return;
    const link = readPastedLoginLink(pastedLink, window.location.origin, process.env.NEXT_PUBLIC_SUPABASE_URL);
    if (!link) {
      setPasteError("Copy the sign-in link from your newest TMS email and paste it here.");
      return;
    }
    setHandoffPending(true);
    setPasteError("");
    try {
      const response = await fetch("/api/auth/callback", {
        method: "POST",
        body: new URLSearchParams({
          token_hash: link.tokenHash,
          type: link.type,
          next: next ?? appHome ?? "/dashboard",
          installed_app: "1",
        }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.destination !== "string") {
        setPasteError("Could not finish signing in. Try again.");
        return;
      }
      const destination = safeAuthNextPath(result.destination, window.location.origin);
      setPastedLink("");
      window.location.replace(destination);
    } catch {
      setPasteError("Could not finish signing in. Check your connection and try again.");
    } finally {
      setHandoffPending(false);
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

        {tenant.status !== "loading" && tenant.userEmail && (
          <div className="mt-4 space-y-2 rounded-md border border-line p-3 text-sm text-ink-2">
            <p>
              This browser is currently signed in as{" "}
              <strong className="break-words text-ink">{tenant.userEmail}</strong>.
            </p>
            {tenant.status === "ready" && (
              <a href={appHome ? next ?? appHome : "/dashboard"} className="inline-block font-semibold text-ink underline">
                Continue to dashboard with this account
              </a>
            )}
            <p>{installedApp
              ? "To switch accounts, request a link for the other email address and paste the link below."
              : "To switch accounts, enter the other email below, open its newest login email and press Continue to TMS Wizard."}</p>
          </div>
        )}

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

        {installedApp && (
          <form onSubmit={handlePastedLink} className="mt-5 grid gap-2 border-t border-line pt-4">
            <p className="text-sm text-ink-2">
              In your email, press and hold the sign-in link and copy it. Return here and paste it before opening it in the browser.
            </p>
            <Field id="app-login-link" label="Paste sign-in link" type="password" autoComplete="off"
              value={pastedLink} onChange={(event) => { setPastedLink(event.target.value); setPasteError(""); }} required />
            {pasteError && <p role="alert" className="text-sm text-danger">{pasteError}</p>}
            <Button type="submit" size="lg" variant="secondary" loading={handoffPending}>Sign in to this app</Button>
          </form>
        )}

        {message ? (
          <div className="mt-4 space-y-3 text-sm text-ink-2">
            <p role="status" aria-live="polite">{message}</p>
            {requestedEmail && <p className="break-words font-semibold text-ink">
              Check {requestedEmail}. Requesting a link does not switch accounts yet.
              {" "}{installedApp ? "Copy the link from the newest email and paste it above."
                : "Open the newest email, then press Continue to TMS Wizard to finish signing in."}
            </p>}
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
