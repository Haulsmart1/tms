"use client";

import type { ReactNode } from "react";
import { CreditCard } from "lucide-react";
import Badge from "../../../components/Badge";
import Button from "../../../components/Button";
import Card from "../../../components/Card";
import Skeleton from "../../../components/Skeleton";
import SquareCardForm from "../../../components/billing/SquareCardForm";
import type { BillingStatus } from "../../../lib/billing/format";

export type BillingRow = {
  company_id: string;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
  status: BillingStatus;
  next_charge_on: string;
};

type Props = {
  loading: boolean;
  billing: BillingRow | null;
  /** True when the page's load failed; card management is then withheld. */
  loadError: boolean;
  /** True while the admin is replacing an existing card. */
  showForm: boolean;
  onReplace: () => void;
  onCancel: () => void;
  onComplete: (response: Record<string, unknown>) => void;
};

/* The icon square from the Settings launcher cards (app/settings/page.tsx),
   so the card reads as part of the same family. */
function IconTile() {
  return (
    <div
      aria-hidden
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-primary-tint text-primary-deep"
    >
      <CreditCard size={18} />
    </div>
  );
}

function expiryLabel(billing: BillingRow): string {
  if (!billing.card_exp_month || !billing.card_exp_year) return "Expiry unknown";
  return `Expires ${String(billing.card_exp_month).padStart(2, "0")}/${billing.card_exp_year}`;
}

export default function PaymentMethodCard({
  loading,
  billing,
  loadError,
  showForm,
  onReplace,
  onCancel,
  onComplete,
}: Props) {
  let body: ReactNode;

  if (loading) {
    /* Fixed-size control rendered real but disabled, data-bearing text as
       skeleton bars: the "only data-bearing leaves" rule from the skeletons
       spec. aria-busy and the status line are owned by the page. */
    body = (
      <div className="flex items-center gap-3">
        <IconTile />
        <div className="grid flex-1 gap-1.5">
          <Skeleton w="60%" h="0.875rem" />
          <Skeleton w="40%" h="0.75rem" />
        </div>
        <Button variant="secondary" size="sm" disabled>
          Replace card
        </Button>
      </div>
    );
  } else if (loadError) {
    body = (
      <p className="m-0 text-sm text-ink-3">
        Card management is unavailable until billing data loads successfully.
      </p>
    );
  } else if (billing && !showForm) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <IconTile />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
            <span>
              {billing.card_brand ?? "Card"} ending {billing.card_last4 ?? "----"}
            </span>
            {billing.status === "past_due" ? (
              <Badge tone="danger">Payment failed</Badge>
            ) : null}
          </div>
          <div className="text-xs text-ink-3">{expiryLabel(billing)}</div>
        </div>
        <Button variant="secondary" size="sm" onClick={onReplace}>
          Replace card
        </Button>
      </div>
    );
  } else if (!billing) {
    body = (
      <div className="grid gap-3">
        <p className="m-0 text-sm text-ink-2">
          Add a card to start your subscription. Your first charge is taken today.
        </p>
        <SquareCardForm onComplete={onComplete} />
      </div>
    );
  } else {
    body = (
      <SquareCardForm
        onComplete={onComplete}
        submitLabel="Save new card"
        onCancel={onCancel}
      />
    );
  }

  return <Card kicker="Payment method">{body}</Card>;
}
