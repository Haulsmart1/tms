import type { ReactNode } from "react";
import Skeleton from "./Skeleton";

/* A generic label/value cell. It was a passenger in app/subcontractors's
   compliance module, which is about compliance and nothing else; it lives here
   now that /vehicles wants it too.

   Note a third near-copy is private to app/customers/CustomerCard.tsx.
   Collapsing it is a change to a shipped, signed-off page for no functional
   gain, so it is deliberately left where it is. */

export default function InfoField({
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
        {/* inline-block keeps this block-level <strong>'s line box at its
            text height. A block skeleton shrinks each cell by 4px, and with
            two rows of cells the card jumps while loading. */}
        {loading ? <Skeleton display="inline-block" w="80%" h="0.875rem" /> : value || "—"}
      </strong>
    </div>
  );
}
