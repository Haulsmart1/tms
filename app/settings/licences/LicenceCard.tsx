import type { ReactNode } from "react";
import Button from "../../../components/Button";
import Skeleton from "../../../components/Skeleton";
import type { VehicleLicence } from "./types";

type Props = {
    licence: VehicleLicence;
    loading?: boolean;
    onToggle: (id: string, active: boolean | null) => void;
    onDelete: (id: string) => void;
};

/* ONE layout definition for both states, per the batch 1 decision: a separate
   skeleton component mirroring these class names drifts the first time anyone
   edits the real card, and no test in this repo would catch it.

   Only data-bearing leaves become skeletons. The heading and the five cells
   are the only values here; the labels, the structure and both buttons render
   for real, the buttons merely disabled.

   Four-space indent, matching page.tsx rather than the rest of the app. */
export default function LicenceCard({ licence, loading = false, onToggle, onDelete }: Props) {
    return (
        <article className="rounded-lg border border-line bg-surface p-4 shadow-sm" aria-busy={loading}>
            <h3 className="m-0 mb-2 text-md font-semibold text-ink">
                {loading ? <Skeleton display="inline-block" w="14ch" h="1rem" /> : licence.licence_type}
            </h3>

            <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Cell
                    label="Vehicle"
                    loading={loading}
                    /* Behind the loading check, not merely optional-chained. A
                       `value` prop is evaluated eagerly, BEFORE Cell looks at
                       `loading`, so every expression here runs three times per
                       frame against PLACEHOLDER_LICENCE, which is
                       `{ id: "skeleton" }` and has no `vehicles`. Optional
                       chaining alone happens to survive that; the first
                       .toUpperCase(), .split() or non-optional access added
                       below would crash the loading state, and nothing under
                       lib/ can test for it. Same reason as VehicleCard's
                       `extra` prop. Keep any new derived cell on this side of
                       the check. */
                    value={
                        loading
                            ? null
                            : licence.vehicles?.registration ||
                              [licence.vehicles?.make, licence.vehicles?.model]
                                  .filter(Boolean)
                                  .join(" ") ||
                              licence.vehicle_id
                    }
                />
                <Cell label="Issue Date" loading={loading} mono value={licence.issue_date || "-"} />
                <Cell label="Expiry Date" loading={loading} mono value={licence.expiry_date || "-"} />
                <Cell label="Billing Status" loading={loading} value={licence.active ? "Active" : "Inactive"} />
                <Cell label="Notes" loading={loading} value={licence.notes || "-"} />
            </div>

            <div className="flex flex-wrap gap-2">
                <Button
                    variant="secondary"
                    disabled={loading}
                    onClick={() => onToggle(licence.id, licence.active)}
                >
                    {/* "Deactivate" while loading: the wider of the two labels,
                        so the button does not grow when the data arrives. */}
                    {loading ? "Deactivate" : licence.active ? "Deactivate" : "Activate"}
                </Button>

                <Button variant="danger" disabled={loading} onClick={() => onDelete(licence.id)}>
                    Delete
                </Button>
            </div>
        </article>
    );
}

/* Local rather than components/InfoField, which is the shared version of this
   cell. Two things differ and both are visible: this page's label is
   text-ink-3 where InfoField's is text-ink-2, and two of the five values are
   font-mono dates. (A third difference, InfoField's em-dash fallback for a
   falsy value against this page's "-", is NOT one: every caller here
   substitutes before the value reaches the cell, so that fallback would never
   fire.) So it is two optional props, mono and a label tone, and growing
   InfoField by them is reasonable. It is not done HERE because changing that
   shared label token restyles two shipped, signed-off pages, which does not
   belong in a loading-skeletons batch. Recorded as a follow-up; if you are
   here to do it, delete this and the five copies InfoField's header lists. */
function Cell({
    label,
    value,
    loading,
    mono,
}: {
    label: string;
    value: ReactNode;
    loading?: boolean;
    mono?: boolean;
}) {
    return (
        <div className="text-sm">
            <span className="text-kicker uppercase text-ink-3">{label}</span>{" "}
            <strong className={mono ? "block font-mono text-ink" : "block text-ink"}>
                {/* inline-block keeps this block <strong>'s line box at text
                    height, so the cell does not shrink while loading. */}
                {loading ? <Skeleton display="inline-block" w="80%" h="0.875rem" /> : value}
            </strong>
        </div>
    );
}
