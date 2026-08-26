"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typings for the Web Payments SDK surface we use.
type SquareCard = {
  attach: (selector: string) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: Array<{ message?: string }> }>;
  destroy: () => Promise<void>;
};

type SquarePayments = {
  card: () => Promise<SquareCard>;
  verifyBuyer: (
    token: string,
    details: {
      intent: "STORE";
      billingContact: { givenName?: string; familyName?: string };
    }
  ) => Promise<{ token: string } | null>;
};

declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => SquarePayments;
    };
  }
}

const APP_ID = process.env.NEXT_PUBLIC_SQUARE_APP_ID ?? "";
const LOCATION_ID = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID ?? "";

// Sandbox app ids are prefixed "sandbox-"; each environment has its own CDN.
const SDK_URL = APP_ID.startsWith("sandbox-")
  ? "https://sandbox.web.squarecdn.com/v1/square.js"
  : "https://web.squarecdn.com/v1/square.js";

type Props = {
  onComplete: (response: Record<string, unknown>) => void;
};

export default function SquareCardForm({ onComplete }: Props) {
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cardholderName, setCardholderName] = useState("");
  const paymentsRef = useRef<SquarePayments | null>(null);
  const cardRef = useRef<SquareCard | null>(null);

  useEffect(() => {
    if (!APP_ID || !LOCATION_ID) {
      setErrorMessage(
        "Square is not configured (missing NEXT_PUBLIC_SQUARE_APP_ID or NEXT_PUBLIC_SQUARE_LOCATION_ID)."
      );
      return;
    }

    let cancelled = false;

    async function loadSdk(): Promise<void> {
      if (window.Square) return;
      // Reuse an existing tag (e.g. a second mount, or React StrictMode's
      // double-invoke) instead of appending a duplicate script element.
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${SDK_URL}"]`
      );
      if (existing) {
        await new Promise<void>((resolve, reject) => {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener(
            "error",
            () => reject(new Error("Square SDK failed to load.")),
            { once: true }
          );
        });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = SDK_URL;
        script.onload = () => resolve();
        script.onerror = () => {
          script.remove();
          reject(new Error("Square SDK failed to load."));
        };
        document.head.appendChild(script);
      });
    }

    async function init() {
      await loadSdk();
      if (cancelled || !window.Square) return;
      const payments = window.Square.payments(APP_ID, LOCATION_ID);
      const card = await payments.card();
      if (cancelled) {
        await card.destroy();
        return;
      }
      await card.attach("#square-card-container");
      if (cancelled) {
        await card.destroy();
        return;
      }
      paymentsRef.current = payments;
      cardRef.current = card;
      setReady(true);
    }

    init().catch((error) => {
      setErrorMessage(
        error instanceof Error ? error.message : "Square SDK failed to load."
      );
    });

    return () => {
      cancelled = true;
      cardRef.current?.destroy().catch(() => {});
      cardRef.current = null;
      paymentsRef.current = null;
    };
  }, []);

  async function submit() {
    const payments = paymentsRef.current;
    const card = cardRef.current;
    if (!payments || !card || submitting) return;

    setSubmitting(true);
    setErrorMessage("");

    try {
      const tokenResult = await card.tokenize();
      if (tokenResult.status !== "OK" || !tokenResult.token) {
        throw new Error(
          tokenResult.errors?.[0]?.message ?? "Card details were not accepted."
        );
      }

      // 3-D Secure. Required to store a UK card; later monthly charges are
      // merchant-initiated and exempt.
      const nameParts = cardholderName.trim().split(/\s+/);
      const verification = await payments.verifyBuyer(tokenResult.token, {
        intent: "STORE",
        billingContact: {
          givenName: nameParts[0] || undefined,
          familyName: nameParts.slice(1).join(" ") || undefined,
        },
      });
      if (!verification?.token) {
        throw new Error("Card verification was not completed.");
      }

      const response = await fetch("/api/billing/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cardToken: tokenResult.token,
          verificationToken: verification.token,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Payment setup failed.");
      }
      onComplete(body);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Payment setup failed."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-3">
      <label className="grid gap-1 text-sm text-ink">
        Name on card
        <input
          type="text"
          value={cardholderName}
          onChange={(e) => setCardholderName(e.target.value)}
          className="rounded-md border border-line bg-surface px-3 py-2 text-ink"
          autoComplete="cc-name"
        />
      </label>

      <div
        id="square-card-container"
        className="rounded-md border border-line bg-surface p-2"
      />

      {errorMessage ? (
        <div className="rounded-md border border-danger px-3 py-2 text-sm text-danger">
          {errorMessage}
        </div>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || submitting}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-50"
      >
        {submitting ? "Processing..." : "Save card and start subscription"}
      </button>
    </div>
  );
}
