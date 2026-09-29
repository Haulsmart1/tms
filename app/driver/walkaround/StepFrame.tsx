"use client";
/* One screen of the walkaround check (Back, heading, body, bottom action), plus its small shared pieces. */

import Link from "next/link";
import type { ReactNode } from "react";
import { w } from "./styles";

export default function StepFrame({
  kicker,
  title,
  onBack,
  error,
  children,
  footer,
}: {
  kicker: string;
  title: string;
  onBack: (() => void) | null;
  error?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      {onBack ? (
        <button type="button" className={w.back} onClick={onBack}>
          &larr; Back
        </button>
      ) : null}
      <section className={w.card}>
        <div className={w.kicker}>{kicker}</div>
        <h1 className={w.title}>{title}</h1>
        <div className="mt-4 grid gap-4">{children}</div>
      </section>
      {error ? (
        <p className={w.error} role="alert">
          {error}
        </p>
      ) : null}
      {footer}
    </>
  );
}

export function NextButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`${w.primary} w-full`} disabled={disabled} onClick={onClick}>
      Next
    </button>
  );
}

export function Notice({ text, retry = null }: { text: string; retry?: (() => void) | null }) {
  return (
    <section className={w.card}>
      <p className={w.body} role="status">
        {text}
      </p>
      <div className="mt-4 grid gap-2">
        {retry ? (
          <button type="button" className={w.secondary} onClick={retry}>
            Try again
          </button>
        ) : null}
        <Link className={w.link} href="/driver/dashboard">
          Back to the dashboard
        </Link>
      </div>
    </section>
  );
}
