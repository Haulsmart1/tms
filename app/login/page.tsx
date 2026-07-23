"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { createClient } from "../../lib/supabase/browser";
import Field from "../../components/Field";
import Button from "../../components/Button";

/* `ds font-sans` is required here for the same reason as the landing page:
   Preflight is off, so this subtree opts into the scoped reset, and font-sans
   is what actually applies IBM Plex. See app/layout.tsx. */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // The auth callback redirects failures here with ?error=..., so an expired
    // or already-used link lands on a page that can send a fresh one.
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) {
      setMessage(
        "That sign-in link didn't work or has expired. Enter your email and we'll send a fresh one.",
      );
    }
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
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/api/auth/callback?next=/dashboard`;
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      setMessage("Login link sent. Check your email.");
      setEmail("");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Unable to start login.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ds grid min-h-screen place-items-center bg-canvas px-4 font-sans text-ink">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm">
        <Link href="/" className="text-sm text-ink-3 hover:text-ink-2">
          Back
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-ink">Sign in</h1>
        <p className="mt-1 text-sm text-ink-2">We&apos;ll email you a magic link.</p>

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
          <p role="status" className="mt-4 text-sm text-ink-2">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
