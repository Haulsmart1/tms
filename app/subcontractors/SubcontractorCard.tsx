import Button from "../../components/Button";
import Skeleton from "../../components/Skeleton";
import InfoField from "../../components/InfoField";
import { getCompliance, mostUrgent } from "../../lib/compliance/expiry";
import { StatusBadge, subcontractorCardStyle } from "./compliance";
import type { Subcontractor } from "./types";

type Props = {
  subcontractor: Subcontractor;
  loading?: boolean;
  onEdit: (subcontractor: Subcontractor) => void;
  onManage: (id: string) => void;
};

/* ONE layout definition for both states, per the batch 1 decision. A separate
   skeleton component mirroring these class names drifts the first time anyone
   edits the real card, and no test in this repo would catch it.

   Only data-bearing leaves become skeletons. Labels, structure and the two
   buttons render for real. */
export default function SubcontractorCard({
  subcontractor,
  loading = false,
  onEdit,
  onManage,
}: Props) {
  /* Derived here rather than passed in. As a prop alongside `loading` it was
     four states, two of them nonsense, and the border and the badge disagreed
     about which one to believe.

     Behind the loading branch on purpose: every placeholder expiry is null and
     getCompliance(null) is amber, so deriving unconditionally would put an
     amber alarm border on every skeleton card. */
  const compliance = loading
    ? null
    : mostUrgent([
        getCompliance(subcontractor.goods_in_transit_expiry),
        getCompliance(subcontractor.public_liability_expiry),
        getCompliance(subcontractor.employers_liability_expiry),
        getCompliance(subcontractor.motor_insurance_expiry),
        getCompliance(subcontractor.waste_carrier_expiry),
      ]);

  return (
    <article
      /* While loading there is no compliance level, so the card takes the
         calm "ok" border rather than flashing a red or amber alarm border
         that the data may not justify. */
      className={subcontractorCardStyle(compliance?.level ?? "ok")}
      aria-busy={loading}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="m-0 text-md font-semibold text-ink">
            {loading ? <Skeleton display="inline-block" w="11ch" h="1rem" /> : subcontractor.name}
          </h3>
          <span className="text-sm text-ink-2">
            {loading ? (
              <Skeleton display="inline-block" w="8ch" h="0.75rem" />
            ) : subcontractor.subcontractor_type === "owner_driver" ? (
              "Owner Driver"
            ) : (
              "Fleet Subcontractor"
            )}
          </span>
        </div>

        {loading || !compliance ? (
          <Skeleton w="4.5rem" h="1.375rem" pill />
        ) : (
          <StatusBadge result={compliance} />
        )}
      </div>

      <div className="my-2 grid grid-cols-2 gap-2">
        <InfoField
          label="Contact"
          loading={loading}
          value={subcontractor.contact_name || subcontractor.email}
        />
        <InfoField label="Phone" loading={loading} value={subcontractor.phone} />
        <InfoField
          label="Operator Licence"
          loading={loading}
          value={subcontractor.operator_licence_number}
        />
        <InfoField
          label="Terms"
          loading={loading}
          value={`${subcontractor.payment_terms_days ?? 30} days`}
        />
      </div>

      {/* Real buttons, disabled. Fixed size and no data, so this is both more
          faithful than a grey rectangle and more honest about being inert. */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={loading}
          onClick={() => onEdit(subcontractor)}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={loading}
          onClick={() => onManage(subcontractor.id)}
        >
          Manage
        </Button>
      </div>
    </article>
  );
}
