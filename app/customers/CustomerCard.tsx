import type { ReactNode } from "react";
import Badge from "../../components/Badge";
import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import type { Customer } from "./types";

type Props = {
  customer: Customer;
  loading?: boolean;
  onEdit: (customer: Customer) => void;
  onDelete: (customer: Customer) => void;
};

/* ONE layout definition for both states. The alternative, a separate
   CustomersSkeleton mirroring these class names, drifts the first time anyone
   edits the real card, and no test in this repo would catch it.

   Only data-bearing leaves become skeletons. Labels, structure and the two
   buttons render for real: they carry no data, so a grey rectangle would be
   less faithful than the thing itself. */
export default function CustomerCard({ customer, loading = false, onEdit, onDelete }: Props) {
  return (
    <article className="rounded-lg border border-line bg-surface-2 p-3" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-md font-semibold text-ink">
            {loading ? <Skeleton display="inline-block" w="9ch" h="1rem" /> : customer.name}
          </h3>
          <span className="font-mono text-xs text-ink-3">
            {loading
              ? <Skeleton display="inline-block" w="6ch" h="0.75rem" />
              : customer.account_code || "No account code"}
          </span>
        </div>

        {loading ? (
          <Skeleton w="4.5rem" h="1.375rem" pill />
        ) : customer.credit_hold ? (
          <Badge tone="danger">Credit Hold</Badge>
        ) : customer.active ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="neutral">Inactive</Badge>
        )}
      </div>

      <div className="my-2 grid grid-cols-2 gap-2">
        <Info label="Contact" loading={loading} value={customer.contact_name || customer.email} />
        <Info label="Phone" loading={loading} value={customer.phone} />
        <Info
          label="Location"
          loading={loading}
          value={[customer.city, customer.postcode].filter(Boolean).join(", ") || null}
        />
        <Info label="Terms" loading={loading} value={`${customer.payment_terms_days ?? 30} days`} />
        <Info
          label="Credit Limit"
          loading={loading}
          value={
            customer.credit_limit === null
              ? "—"
              : `£${Number(customer.credit_limit).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`
          }
        />
        <Info label="Service" loading={loading} value={customer.service_level || "Standard"} />
      </div>

      {/* Two placeholder pills is a guess: the real row holds nought to five
          badges and the count is unknowable before the data lands. This row
          will shift. Recorded in the spec rather than papered over. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {loading ? (
          <>
            <Skeleton w="3.5rem" h="1.375rem" pill />
            <Skeleton w="4.5rem" h="1.375rem" pill />
          </>
        ) : (
          <>
            {customer.adr_required ? <Badge tone="neutral">ADR</Badge> : null}
            {customer.tail_lift_required ? <Badge tone="neutral">Tail Lift</Badge> : null}
            {customer.timed_delivery_required ? <Badge tone="neutral">Timed</Badge> : null}
            {customer.pod_required ? <Badge tone="neutral">POD</Badge> : null}
            {customer.api_enabled ? <Badge tone="info">API</Badge> : null}
          </>
        )}
      </div>

      {/* Real buttons, disabled. Fixed size, no data, so this is both more
          faithful than a grey rectangle and more honest about being inert. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" type="button" disabled={loading} onClick={() => onEdit(customer)}>
          Edit
        </Button>
        <Button variant="danger" size="sm" type="button" disabled={loading} onClick={() => onDelete(customer)}>
          Delete
        </Button>
      </div>
    </article>
  );
}

function Info({
  label,
  value,
  loading,
}: {
  label: string;
  value: ReactNode;
  loading?: boolean;
}) {
  return (
    <div className="text-sm">
      <span className="text-kicker uppercase text-ink-2">{label}</span>{" "}
      <strong className="block text-ink">
        {/* display="inline-block" is load-bearing, not cosmetic. This <strong> is
            block-level at text-sm, so its line box is 18px with text in it. A
            block skeleton would make it 14px instead, shrinking every Info cell
            by 4px: three rows of them, so the card jumps 12px shorter while
            loading and back again on arrival. inline-block keeps the 18px strut
            and the cell holds its height. */}
        {loading ? <Skeleton display="inline-block" w="80%" h="0.875rem" /> : value || "—"}
      </strong>
    </div>
  );
}
