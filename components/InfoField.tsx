import type { ReactNode } from "react";
import Skeleton from "./Skeleton";

/* Renders correctly ONLY inside a `.ds` wrapper. Preflight is disabled, so the
   text-kicker, text-ink-2 and text-ink tokens below resolve through the scoped
   reset in app/globals.css; outside `.ds` they do not apply.

   A read-only display cell, NOT components/Field.tsx, which is an editable
   input control with a label.

   A generic label/value cell. It was a passenger in app/subcontractors's
   compliance module, which is about compliance and nothing else; it lives here
   now that /vehicles wants it too.

   FIVE near-copies remain private to their pages, and this list is the only
   record of them: app/customers/CustomerCard.tsx, app/drivers/page.tsx,
   app/invoices/page.tsx, app/maintenance/page.tsx and app/assets/page.tsx.
   A sixth, `Cell` in app/settings/licences/LicenceCard.tsx, differs on
   purpose: see the comment above it. Collapsing any of them is a change to a
   shipped, signed-off page for no functional gain, so they are deliberately
   left where they are. Add to this list if you write another. */

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
