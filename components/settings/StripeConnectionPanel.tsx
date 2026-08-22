"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

import Button from "../Button";
import Card from "../Card";

type StripeStatusResponse = {
  ok?: boolean;
  connected?: boolean;
  connectionStatus?: string;
  stripeAccountId?: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  country?: string | null;
  defaultCurrency?: string | null;
  requirementsCurrentlyDue?: string[];
  disabledReason?: string | null;
  lastSyncedAt?: string | null;
  error?: string;
};

type StripeConnectResponse = {
  ok?: boolean;
  tenantId?: string;
  stripeAccountId?: string;
  onboardingUrl?: string;
  expiresAt?: string;
  error?: string;
};

type Props = {
  tenantId: string;
};

function statusLabel(
  status: string
): string {
  switch (status) {
    case "connected":
      return "Connected";

    case "onboarding":
      return "Setup in progress";

    case "restricted":
      return "Action required";

    default:
      return "Not connected";
  }
}

export default function StripeConnectionPanel({
  tenantId,
}: Props) {
  const [
    status,
    setStatus,
  ] = useState<StripeStatusResponse | null>(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    connecting,
    setConnecting,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  const [
    notice,
    setNotice,
  ] = useState("");

  const loadStatus =
    useCallback(
      async () => {
        setLoading(true);
        setError("");

        try {
          const response =
            await fetch(
              `/api/settings/payments/stripe/status?tenantId=${encodeURIComponent(
                tenantId
              )}`,
              {
                method: "GET",
                cache: "no-store",
              }
            );

          const body =
            (await response.json()) as StripeStatusResponse;

          if (!response.ok) {
            throw new Error(
              body.error ||
                "Unable to load Stripe connection status."
            );
          }

          setStatus(body);
        }
        catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load Stripe connection status."
          );
        }
        finally {
          setLoading(false);
        }
      },
      [
        tenantId,
      ]
    );

  useEffect(() => {
    void loadStatus();

    const params =
      new URLSearchParams(
        window.location.search
      );

    const stripeReturn =
      params.get("stripe");

    if (
      stripeReturn === "return"
    ) {
      setNotice(
        "Stripe onboarding returned successfully. Connection status has been refreshed."
      );
    }

    if (
      stripeReturn === "refresh"
    ) {
      setNotice(
        "Your Stripe onboarding link expired or needs refreshing. Select Continue Stripe Setup."
      );
    }
  }, [
    loadStatus,
  ]);

  async function startConnection() {
    if (connecting) {
      return;
    }

    setConnecting(true);
    setError("");
    setNotice("");

    try {
      const response =
        await fetch(
          "/api/settings/payments/stripe/connect",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                tenantId,
              }),
          }
        );

      const body =
        (await response.json()) as StripeConnectResponse;

      if (!response.ok) {
        throw new Error(
          body.error ||
            "Unable to start Stripe onboarding."
        );
      }

      if (!body.onboardingUrl) {
        throw new Error(
          "Stripe onboarding URL was not returned."
        );
      }

      const onboardingUrl =
        new URL(
          body.onboardingUrl
        );

      if (
        onboardingUrl.protocol !==
        "https:"
      ) {
        throw new Error(
          "Stripe onboarding URL is invalid."
        );
      }

      window.location.assign(
        onboardingUrl.toString()
      );
    }
    catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : "Unable to start Stripe onboarding."
      );

      setConnecting(false);
    }
  }

  const connectionStatus =
    status?.connectionStatus ??
    "not_connected";

  const connected =
    connectionStatus ===
    "connected";

  const requirements =
    status?.requirementsCurrentlyDue ??
    [];

  return (
    <Card kicker="Payments">
      <div className="grid gap-4">
        <div>
          <h2 className="m-0 text-md font-semibold text-ink">
            Stripe Payments
          </h2>

          <p className="mb-0 mt-1 text-sm text-ink-3">
            Connect your company&apos;s Stripe account to accept
            pro forma card payments from quotation customers.
          </p>
        </div>

        <div className="grid gap-3 rounded-md border border-line bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <div className="text-kicker uppercase text-ink-3">
              Status
            </div>

            <div className="mt-1 font-semibold text-ink">
              {loading
                ? "Checking..."
                : statusLabel(
                    connectionStatus
                  )}
            </div>
          </div>

          <div>
            <div className="text-kicker uppercase text-ink-3">
              Card payments
            </div>

            <div className="mt-1 font-semibold text-ink">
              {status?.chargesEnabled
                ? "Enabled"
                : "Not enabled"}
            </div>
          </div>

          <div>
            <div className="text-kicker uppercase text-ink-3">
              Payouts
            </div>

            <div className="mt-1 font-semibold text-ink">
              {status?.payoutsEnabled
                ? "Enabled"
                : "Not enabled"}
            </div>
          </div>

          <div>
            <div className="text-kicker uppercase text-ink-3">
              Currency
            </div>

            <div className="mt-1 font-semibold uppercase text-ink">
              {status?.defaultCurrency ||
                "—"}
            </div>
          </div>
        </div>

        {notice ? (
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-danger bg-surface px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {connectionStatus ===
          "restricted" ? (
          <div className="rounded-md border border-line bg-surface-2 px-3 py-3 text-sm text-ink">
            <div className="font-semibold">
              Stripe needs additional information.
            </div>

            {status?.disabledReason ? (
              <div className="mt-1 text-ink-3">
                Reason:{" "}
                {
                  status.disabledReason
                }
              </div>
            ) : null}
          </div>
        ) : null}

        {requirements.length >
        0 ? (
          <div className="rounded-md border border-line bg-surface-2 px-3 py-3">
            <div className="text-sm font-semibold text-ink">
              Information required by Stripe
            </div>

            <ul className="mb-0 mt-2 grid gap-1 pl-5 text-sm text-ink-3">
              {requirements.map(
                (
                  requirement
                ) => (
                  <li
                    key={
                      requirement
                    }
                  >
                    {
                      requirement
                    }
                  </li>
                )
              )}
            </ul>
          </div>
        ) : null}

        {connected ? (
          <div className="rounded-md border border-line bg-surface-2 px-3 py-3 text-sm text-ink">
            <div className="font-semibold">
              Stripe is ready.
            </div>

            <div className="mt-1 text-ink-3">
              This tenant can accept card payments once the quotation
              Checkout flow is enabled.
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <Button
              type="button"
              loading={
                connecting
              }
              disabled={
                loading ||
                connecting
              }
              onClick={() =>
                void startConnection()
              }
            >
              {connectionStatus ===
              "not_connected"
                ? "Connect Stripe"
                : "Continue Stripe Setup"}
            </Button>
          ) : null}

          <Button
            type="button"
            variant="secondary"
            disabled={
              loading ||
              connecting
            }
            onClick={() =>
              void loadStatus()
            }
          >
            Refresh Status
          </Button>
        </div>

        <p className="m-0 text-xs text-ink-3">
          Bank and verification details are entered directly with Stripe.
          TMS Wizard does not store card numbers, CVV codes, or Stripe
          account passwords.
        </p>
      </div>
    </Card>
  );
}