"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Field from "../../components/Field";
import Button from "../../components/Button";
import MessageBanner from "../../components/MessageBanner";
import { BILLING_BASIS_SENTENCE, pricingHeadline } from "../../lib/billing/pricingCopy";
import {
  SIGNUP_HONEYPOT_FIELD,
  describeSignupFieldErrors,
  type SignupFieldErrors,
} from "../../lib/validation/signup";
import { SIGNUP_FAILED_MESSAGE, SIGNUP_SENT_MESSAGE } from "../../lib/auth/signup";

/* Self-serve signup (docs/superpowers/specs/2026-09-16-self-serve-signup-design.md).
   Same skeleton as app/login/page.tsx: `ds font-sans` opts this subtree into
   the scoped reset and IBM Plex (Preflight is off, see app/layout.tsx), and
   the page follows the theme because it is listed in lib/nav/themeableRoutes.ts.

   The server is authoritative. describeSignupFieldErrors mirrors the route's
   Zod schema so a typo is caught before a request, and the same field-keyed
   errors are rendered when the server answers 400. On success the form is
   replaced in place by the check-your-inbox state; there is no redirect,
   because the next step is in the inbox, not here. */

type Status = "idle" | "submitting" | "sent";

export default function SignupPage() {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [sentMessage, setSentMessage] = useState("");

  const pricing = pricingHeadline();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "submitting") return;

    setError("");
    const clientErrors = describeSignupFieldErrors({ companyName, contactName, email });
    setFieldErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    /* The honeypot travels with the body exactly as the request-access form
       sends it: an uncontrolled input real users never see. */
    const form = event.currentTarget;
    const honeypot = (form.elements.namedItem(SIGNUP_HONEYPOT_FIELD) as HTMLInputElement | null)?.value ?? "";

    setStatus("submitting");
    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          contactName: contactName.trim(),
          email: email.trim(),
          [SIGNUP_HONEYPOT_FIELD]: honeypot,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        fieldErrors?: Record<string, string[] | undefined>;
      };

      if (!response.ok) {
        if (payload.fieldErrors) {
          const next: SignupFieldErrors = {};
          for (const key of ["companyName", "contactName", "email"] as const) {
            const first = payload.fieldErrors[key]?.[0];
            if (first) next[key] = first;
          }
          setFieldErrors(next);
          if (Object.keys(next).length === 0) setError("Please check the highlighted fields.");
        } else {
          setError(payload.error ?? SIGNUP_FAILED_MESSAGE);
        }
        setStatus("idle");
        return;
      }

      setSentMessage(payload.message ?? SIGNUP_SENT_MESSAGE);
      setStatus("sent");
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
      setStatus("idle");
    }
  }

  return (
    <div className="ds grid min-h-screen place-items-center bg-canvas px-4 py-8 font-sans text-ink">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-sm">
        {/* Explicit `underline`, as on /login: the .ds reset strips the UA
            underline from anchors, so a link has to opt back in. */}
        <Link href="/" className="text-sm text-ink-2 underline hover:text-ink">
          Back to home
        </Link>

        {status === "sent" ? (
          <div role="status" className="mt-2">
            <h1 className="text-xl font-semibold text-ink">Check your inbox</h1>
            <p className="mt-2 text-sm text-ink-2">{sentMessage}</p>
            <p className="mt-2 text-sm text-ink-2">
              The link signs you in and opens your new console. If it does not arrive within a
              few minutes, check your spam folder or try again.
            </p>
          </div>
        ) : (
          <>
            <h1 className="mt-2 text-xl font-semibold text-ink">Create your account</h1>
            <p className="mt-1 text-sm text-ink-2">{pricing.summary}</p>

            <MessageBanner tone="danger" className="mt-4">
              {error || null}
            </MessageBanner>

            <form onSubmit={handleSubmit} className="mt-4 grid gap-4" noValidate>
              {/* Honeypot: real users never see or focus this. sr-only and
                  aria-hidden keep it out of view and out of the accessibility
                  tree; tabIndex -1 keeps it out of the tab order. Same markup as
                  components/landing/RequestAccessForm.tsx. */}
              <div className="sr-only" aria-hidden="true">
                <label htmlFor={SIGNUP_HONEYPOT_FIELD}>Company website</label>
                <input
                  id={SIGNUP_HONEYPOT_FIELD}
                  name={SIGNUP_HONEYPOT_FIELD}
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              <Field
                id="companyName"
                name="companyName"
                label="Company name"
                autoComplete="organization"
                placeholder="Northgate Haulage Ltd"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                error={fieldErrors.companyName}
                required
              />
              <Field
                id="contactName"
                name="contactName"
                label="Your name"
                autoComplete="name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                error={fieldErrors.contactName}
                required
              />
              <Field
                id="email"
                name="email"
                type="email"
                label="Work email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={fieldErrors.email}
                required
              />
              <Button type="submit" size="lg" loading={status === "submitting"}>
                Create account
              </Button>
            </form>

            <p className="mt-3 text-xs text-ink-3">{BILLING_BASIS_SENTENCE}</p>

            <p className="mt-4 text-xs text-ink-3">
              By continuing you agree to our{" "}
              <a href="/terms" className="underline hover:text-ink">
                terms
              </a>{" "}
              and{" "}
              <a href="/privacy" className="underline hover:text-ink">
                privacy notice
              </a>
              .
            </p>

            <p className="mt-2 text-xs text-ink-3">
              Already have an account?{" "}
              <Link href="/login" className="underline hover:text-ink">
                Log in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
