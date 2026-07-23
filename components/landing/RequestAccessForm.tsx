"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import Field from "../Field";
import Textarea from "../Textarea";
import Button from "../Button";
import Container from "../Container";

type FieldKey = "companyName" | "contactName" | "email" | "phone" | "vehicles" | "notes";
type FieldErrors = Partial<Record<FieldKey, string[]>>;

export default function RequestAccessForm() {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Button deliberately stays focusable while loading, so that disabling it
    // does not drop keyboard focus to <body> mid-submit. The double-submit
    // guard therefore lives here instead.
    if (loading) return;

    setErrors({});
    setMessage("");
    setLoading(true);

    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());

    try {
      const res = await fetch("/api/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.ok && data.ok) {
        setDone(true);
        return;
      }
      if (data.fieldErrors) setErrors(data.fieldErrors as FieldErrors);
      setMessage(
        data.error ??
          (res.status === 429
            ? "Too many requests. Please try again shortly."
            : "Please check the highlighted fields."),
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="request-access" className="border-t border-line bg-surface py-12 md:py-16">
      <Container className="grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold text-ink">Request access</h2>
          <p className="mt-2 max-w-sm text-base text-ink-2">
            Tell us about your operation and we&apos;ll get you set up. Self-serve signup is
            coming soon.
          </p>
          <p className="mt-3 text-sm text-ink-3">
            Already a customer?{" "}
            <Link href="/login" className="font-semibold text-primary hover:text-primary-hover">
              Sign in
            </Link>
          </p>
        </div>

        {done ? (
          <div className="rounded-lg border border-success-border bg-success-tint p-6" role="status">
            <p className="text-base font-semibold text-success-strong">Request sent.</p>
            <p className="mt-1 text-sm text-ink-2">Thanks. We will be in touch shortly.</p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="grid gap-4 rounded-lg border border-line bg-surface-2 p-4 sm:p-6"
          >
            {/* Honeypot. Real users never see or focus this; the route silently
                drops any submission where it arrives non-empty. aria-hidden and
                tabIndex -1 keep it out of the accessibility tree and tab order. */}
            <div className="sr-only" aria-hidden="true">
              <label htmlFor="companyWebsite">Company website</label>
              <input
                id="companyWebsite"
                name="companyWebsite"
                type="text"
                tabIndex={-1}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="companyName"
                name="companyName"
                label="Company name"
                autoComplete="organization"
                required
                error={errors.companyName?.[0]}
              />
              <Field
                id="contactName"
                name="contactName"
                label="Contact name"
                autoComplete="name"
                required
                error={errors.contactName?.[0]}
              />
              <Field
                id="email"
                name="email"
                type="email"
                label="Email"
                autoComplete="email"
                required
                error={errors.email?.[0]}
              />
              <Field
                id="phone"
                name="phone"
                type="tel"
                label="Phone (optional)"
                autoComplete="tel"
                error={errors.phone?.[0]}
              />
              <Field
                id="vehicles"
                name="vehicles"
                type="number"
                min={1}
                inputMode="numeric"
                label="Vehicles"
                required
                error={errors.vehicles?.[0]}
                wrapperClassName="sm:col-span-2"
              />
            </div>

            <Textarea
              id="notes"
              name="notes"
              label="Notes (optional)"
              rows={4}
              hint="Anything about your haulage, delivery or fleet operation."
              error={errors.notes?.[0]}
            />

            {/* The single form-level live region. Per-field errors are plain
                text referenced by aria-describedby, so six failing fields do
                not mount six assertive regions that interrupt each other. */}
            {message ? (
              <p role="alert" className="text-sm text-danger-strong">
                {message}
              </p>
            ) : null}

            <Button type="submit" size="lg" loading={loading}>
              Request access
            </Button>
          </form>
        )}
      </Container>
    </section>
  );
}
