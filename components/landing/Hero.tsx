import Link from "next/link";
import Badge from "../Badge";
import Container from "../Container";
import { buttonClasses } from "../Button";

type Row = {
  ref: string;
  customer: string;
  tone: "info" | "success" | "warning";
  status: string;
  value: string;
};

const rows: Row[] = [
  { ref: "TMS-2381", customer: "ADR Carriers", tone: "info", status: "In transit", value: "£12,480" },
  { ref: "TMS-2380", customer: "Example Freight", tone: "success", status: "Delivered", value: "£3,940" },
  { ref: "TMS-2379", customer: "Sample Logistics", tone: "warning", status: "Awaiting POD", value: "£1,220" },
];

/* The hero shows the real product rather than a photograph. The design system
   forbids photography behind text, and a sceptical operator wants to see the
   tool before filling in a form. */
function ProductMock() {
  return (
    <div
      className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-lg"
      role="img"
      aria-label="Illustrative screenshot of the TMS Wizzard jobs dashboard, showing three example transport jobs with their status and value."
    >
      <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-3">
        <span className="text-sm font-semibold text-ink">Jobs, today</span>
        {/* Labelled explicitly: these are illustrative rows with invented
            values, shown on a public marketing page. Presenting fabricated
            figures as a real customer dashboard would be misleading. */}
        <span className="text-overline uppercase text-ink-2">Example data</span>
      </div>
      {/* aria-hidden: the whole mock is already described by the role="img"
          label above, so the table should not be re-read cell by cell. */}
      <table className="w-full border-collapse text-sm" aria-hidden="true">
        <thead>
          <tr className="bg-surface-2 text-overline uppercase text-ink-3">
            <th className="px-4 py-2 text-left font-semibold">Ref</th>
            <th className="px-4 py-2 text-left font-semibold">Customer</th>
            <th className="px-4 py-2 text-left font-semibold">Status</th>
            <th className="px-4 py-2 text-right font-semibold">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ref} className="border-t border-line">
              <td className="px-4 py-2 font-mono font-medium text-ink-2">{r.ref}</td>
              <td className="px-4 py-2 text-ink">{r.customer}</td>
              <td className="px-4 py-2">
                <Badge tone={r.tone}>{r.status}</Badge>
              </td>
              <td className="px-4 py-2 text-right font-mono font-medium tabular-nums text-ink">
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Hero() {
  return (
    <section className="py-12 md:py-16">
      <Container className="grid items-center gap-10 min-[820px]:grid-cols-2">
        <div>
          <span className="inline-flex items-center rounded-full border border-primary-tint-border bg-primary-tint px-3 py-1 text-overline uppercase text-primary-deep">
            All-in-one cloud TMS
          </span>
          <h1 className="mt-4 text-2xl font-semibold leading-tight text-ink sm:text-[34px] sm:leading-[1.1]">
            Run your whole transport operation in one place.
          </h1>
          <p className="mt-3 max-w-md text-md leading-relaxed text-ink-2">
            Jobs, proof of delivery, invoicing, fleet, drivers and subcontractors, one cloud
            platform built for UK and European haulage.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="#request-access" className={buttonClasses("primary", "lg")}>
              Get started
            </a>
            <Link href="/login" className={buttonClasses("secondary", "lg")}>
              Sign in
            </Link>
          </div>
          <p className="mt-4 text-xs text-ink-2">
            Built for UK and EU operators · WCAG 2.1 AA · Your data stays yours
          </p>
        </div>
        <ProductMock />
      </Container>
    </section>
  );
}
