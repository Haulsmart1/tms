"use client";

import { useEffect, useRef, useState } from "react";
import Button, { buttonClasses } from "../../components/Button";
import Field from "../../components/Field";
import Modal from "../../components/Modal";
import { whatsappTrackingUrl } from "../../lib/tracking/whatsapp";

type Props = {
  open: boolean;
  onClose: () => void;
  /** The stop's own tenant, which is what the routes authorize against. */
  tenantId: string;
  stopId: string;
};

type Minted = {
  url: string;
  contactEmail: string | null;
  contactPhone: string | null;
};

type Phase = "minting" | "ready" | "failed" | "revoked";

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, data: data && typeof data === "object" ? data : {} };
  } catch {
    return { ok: false, data: { error: "Could not reach the server. Check your connection and try again." } };
  }
}

/* The routes' error strings are written for the user (429 rate limit, 409
   stop not trackable, 404, 503 when the tracking tables are missing), so
   they are shown as given. */
function routeError(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error.trim() ? data.error : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/*
  Send a customer tracking link for one delivery stop: email (sent by the
  server, recipient restricted like POD email), WhatsApp (opens a prefilled
  message on this device), copy, or withdraw every live link for the stop.

  A link is minted once per opening. The ref pair below keeps React's
  development double-run of effects from minting twice, and the attempt
  counter drops any answer that arrives after the dialog was closed.
*/
export default function SendTrackingLinkDialog({ open, onClose, tenantId, stopId }: Props) {
  const [phase, setPhase] = useState<Phase>("minting");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const mintedForRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const linkInputRef = useRef<HTMLInputElement>(null);

  function mint() {
    const attempt = ++attemptRef.current;
    setPhase("minting");
    setMinted(null);
    setMessage("");
    setError("");
    setBusy(true);
    void (async () => {
      const { ok, data } = await postJson("/api/tracking-links", { tenantId, stopId });
      if (attempt !== attemptRef.current) return;
      setBusy(false);
      const url = stringOrNull(data.url);
      if (!ok || !url) {
        setPhase("failed");
        setError(routeError(data, "Unable to create a tracking link."));
        return;
      }
      const next: Minted = {
        url,
        contactEmail: stringOrNull(data.contactEmail),
        contactPhone: stringOrNull(data.contactPhone),
      };
      setMinted(next);
      setEmail(next.contactEmail ?? "");
      setPhone(next.contactPhone ?? "");
      setPhase("ready");
    })();
  }

  useEffect(() => {
    if (!open) {
      mintedForRef.current = null;
      attemptRef.current += 1;
      return;
    }
    const key = `${tenantId}:${stopId}`;
    if (mintedForRef.current === key) return;
    mintedForRef.current = key;
    mint();
    /* mint reads only tenantId and stopId, both listed; it is not a
       dependency itself because it is a new function every render. */
  }, [open, tenantId, stopId]);

  async function sendEmail() {
    if (busy) return;
    const attempt = attemptRef.current;
    setBusy(true);
    setError("");
    setMessage("");
    const { ok, data } = await postJson("/api/tracking-links/email", { tenantId, stopId, to: email.trim() });
    if (attempt !== attemptRef.current) return;
    setBusy(false);
    if (ok) setMessage(`Tracking link emailed to ${stringOrNull(data.recipient) ?? email.trim()}.`);
    else setError(routeError(data, "Unable to email the tracking link."));
  }

  async function copy() {
    if (!minted) return;
    setError("");
    setMessage("");
    try {
      await navigator.clipboard.writeText(minted.url);
      setMessage("Link copied.");
    } catch {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
      setError("Copy failed. The link is selected: copy it by hand.");
    }
  }

  async function revoke() {
    if (busy) return;
    const attempt = attemptRef.current;
    setBusy(true);
    setError("");
    setMessage("");
    const { ok, data } = await postJson("/api/tracking-links/revoke", { tenantId, stopId });
    if (attempt !== attemptRef.current) return;
    setBusy(false);
    if (ok) {
      const revoked = typeof data.revoked === "number" ? data.revoked : 0;
      setMinted(null);
      setPhase("revoked");
      setMessage(
        `Withdrew ${revoked} ${revoked === 1 ? "link" : "links"}. Withdrawn links no longer open.`,
      );
    } else {
      setError(routeError(data, "Unable to withdraw the links."));
    }
  }

  const whatsappHref = minted ? whatsappTrackingUrl(phone, minted.url) : null;
  const linkId = `tracking-link-${stopId}`;
  const emailId = `tracking-email-${stopId}`;
  const phoneId = `tracking-phone-${stopId}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send tracking link"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="grid gap-4">
        <p className="text-ink-2">
          The customer sees an estimated arrival time, and a live map only once this delivery is next. They never see the
          driver, the vehicle or other stops.
        </p>

        {phase === "minting" ? (
          <p className="text-ink-2" role="status">
            Creating link...
          </p>
        ) : null}

        {minted ? (
          <>
            <div className="grid gap-1.5">
              <label htmlFor={linkId} className="text-sm font-medium text-ink-2">
                Tracking link
              </label>
              <input
                id={linkId}
                ref={linkInputRef}
                readOnly
                value={minted.url}
                onFocus={(event) => event.currentTarget.select()}
                className="h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 font-mono text-xs text-ink"
              />
              <div>
                <Button variant="secondary" size="sm" onClick={() => void copy()}>
                  Copy link
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Field
                id={emailId}
                label="Email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <div>
                <Button size="sm" onClick={() => void sendEmail()} disabled={busy || !email.trim()}>
                  {busy ? "Working..." : "Email link"}
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <Field
                id={phoneId}
                label="Mobile for WhatsApp"
                type="tel"
                autoComplete="off"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2">
                {whatsappHref ? (
                  <a
                    className={buttonClasses("secondary", "sm")}
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open WhatsApp
                  </a>
                ) : (
                  <Button variant="secondary" size="sm" disabled>
                    Open WhatsApp
                  </Button>
                )}
                {!whatsappHref && phone.trim() ? (
                  <span className="text-xs text-ink-2">Enter a full mobile number, at least 10 digits.</span>
                ) : null}
              </div>
            </div>
          </>
        ) : null}

        {phase === "ready" || phase === "revoked" ? (
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {phase === "ready" ? (
              <Button variant="danger" size="sm" onClick={() => void revoke()} disabled={busy}>
                Withdraw all links for this stop
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={mint} disabled={busy}>
                Create a new link
              </Button>
            )}
          </div>
        ) : null}

        {phase === "failed" ? (
          <div>
            <Button variant="secondary" size="sm" onClick={mint} disabled={busy}>
              Try again
            </Button>
          </div>
        ) : null}

        {message ? (
          <div
            role="status"
            className="rounded-md border border-success-border bg-success-tint p-2.5 text-sm text-success-strong"
          >
            {message}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-danger-border bg-danger-tint p-2.5 text-sm text-danger-strong"
          >
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
