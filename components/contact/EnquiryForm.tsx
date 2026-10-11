"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Field from "../Field";
import Select from "../Select";
import Textarea from "../Textarea";
import Button from "../Button";
import { FORMSUBMIT_ACTION, FORMSUBMIT_AJAX, PUBLIC_CONTACT } from "../../lib/contact/details";
import { ENQUIRY_TYPES, EnquirySchema, FORM_OPTIONS, formSubmitPayload, formSubmitResult, type EnquiryErrors } from "../../lib/contact/enquiry";

export default function EnquiryForm() {
  const [enhanced, setEnhanced] = useState(false);
  const [errors, setErrors] = useState<EnquiryErrors>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setEnhanced(true);
    return () => controllerRef.current?.abort();
  }, []);
  useEffect(() => { if (done) resultRef.current?.focus(); }, [done]);
  useEffect(() => {
    const firstField = Object.keys(errors)[0];
    if (!firstField) return;
    const input = formRef.current?.elements.namedItem(firstField);
    if (input instanceof HTMLElement) input.focus();
  }, [errors]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    setErrors({});
    setMessage("");
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const honey = typeof values._honey === "string" ? values._honey : "";
    if (honey.trim()) { setDone(true); return; }
    const parsed = EnquirySchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors(fieldErrors);
      setMessage("Please check the highlighted fields before sending your enquiry.");
      return;
    }
    sending.current = true;
    setLoading(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(FORMSUBMIT_AJAX, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(formSubmitPayload(parsed.data)),
        signal: controller.signal,
        credentials: "omit",
      });
      const result = formSubmitResult(await response.json());
      if (response.ok && result === "submitted") { setDone(true); return; }
      if (result === "activation-required") {
        setMessage("The enquiry form is not available yet. Please email us or call using the contact details on this page.");
      } else if (response.status === 429) {
        setMessage("Too many enquiries have been sent. Please try again later, or email us or call instead.");
      } else {
        setMessage("We couldn’t confirm your enquiry was submitted. Your details are still in the form. Please try again, email us or call instead.");
      }
    } catch {
      setMessage("We couldn’t confirm your enquiry was submitted. Your details are still in the form. Please try again, email us or call instead.");
    } finally {
      clearTimeout(timer);
      controllerRef.current = null;
      sending.current = false;
      setLoading(false);
    }
  }

  if (done) return (
    <div ref={resultRef} tabIndex={-1} role="status" className="rounded-lg border border-success-border bg-success-tint p-6">
      <h2 className="text-xl font-semibold text-success-strong">Enquiry submitted</h2>
      <p className="mt-3 text-base text-ink-2">Thank you for contacting TMS Wizard. Your enquiry has been submitted for processing.</p>
      <p className="mt-3 text-base text-ink-2">To follow up, call <a href={PUBLIC_CONTACT.phoneHref} className="underline">{PUBLIC_CONTACT.phone}</a> or email <a href={`mailto:${PUBLIC_CONTACT.email}`} className="break-all underline">{PUBLIC_CONTACT.email}</a>.</p>
    </div>
  );

  return (
    <form ref={formRef} id="enquiry-form" action={FORMSUBMIT_ACTION} method="POST" onSubmit={handleSubmit} noValidate={enhanced} aria-labelledby="enquiry-heading" aria-busy={loading} className="grid min-w-0 gap-4 rounded-lg border border-line bg-surface p-5 sm:p-6">
      <h2 id="enquiry-heading" className="text-xl font-semibold">Send an enquiry</h2>
      <p className="text-sm text-ink-2">Tell us about your transport operation or the help you need. Fields marked “required” must be completed.</p>
      {Object.entries(FORM_OPTIONS).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      {/* FormSubmit's documented honeypot; also checked before AJAX. Keep its
          native CAPTCHA defaults, rather than adding _captcha=false. */}
      <div className="hidden" aria-hidden="true"><label htmlFor="contact-website">Leave this field empty</label><input id="contact-website" name="_honey" type="text" tabIndex={-1} autoComplete="off" /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="contact-name" name="name" label="Your name (required)" autoComplete="name" required minLength={2} maxLength={100} error={errors.name?.[0]} />
        <Field id="contact-company" name="company" label="Company / business name (required)" autoComplete="organization" required minLength={2} maxLength={150} error={errors.company?.[0]} />
        <Field id="contact-email" name="email" type="email" label="Email address (required)" autoComplete="email" required maxLength={254} error={errors.email?.[0]} />
        <Field id="contact-phone" name="phone" type="tel" label="Telephone (optional)" autoComplete="tel" maxLength={40} error={errors.phone?.[0]} />
        <Select id="contact-enquiry" name="enquiry" label="Enquiry type (required)" defaultValue="Product enquiry" required error={errors.enquiry?.[0]}>
          {ENQUIRY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
        </Select>
        <Field id="contact-vehicles" name="vehicles" type="number" label="Fleet size (optional)" min={1} max={10000} step={1} inputMode="numeric" error={errors.vehicles?.[0]} />
      </div>
      <Textarea id="contact-message" name="message" label="Your enquiry (required)" rows={6} required minLength={10} maxLength={5000} error={errors.message?.[0]} />
      <p className="text-sm text-ink-2">For a product enquiry, include the workflows you want to manage, such as jobs, POD or invoicing. Please keep passwords and customer delivery records out of this form.</p>
      <p className="text-xs leading-relaxed text-ink-2">This form uses FormSubmit to forward your enquiry to {PUBLIC_CONTACT.email}. Read our <Link href="/privacy" className="underline">Privacy Notice</Link> and <a href="https://formsubmit.co/privacy.pdf" className="underline">FormSubmit’s privacy information</a> before sending.</p>
      <p role="alert" aria-atomic="true" className="text-sm text-danger-strong">{message}</p>
      <Button type="submit" size="lg" loading={loading} className="w-full sm:w-auto sm:justify-self-start">{loading ? "Sending enquiry…" : "Send enquiry"}</Button>
      <noscript><p className="text-sm text-ink-2">After sending, FormSubmit will guide you through any verification and return you to TMS Wizard. You can also use the email address or telephone number on this page.</p></noscript>
    </form>
  );
}
