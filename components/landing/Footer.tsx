import Link from "next/link";
import Container from "../Container";
import { LEGAL_INDEX_PATH } from "../../lib/legal/routes";
import { VENDOR } from "../../lib/legal/vendor";

/* Shared by the landing page and every policy page (components/legal/LegalShell).

   Privacy and Terms were hidden here while they were href="#" placeholders
   (review SET-26). The pages now exist, so the links are back.

   The identity line is the website disclosure a UK company has to make
   (company name, where registered, number, registered office). The company
   number is printed only when lib/legal/vendor.ts knows it: a marketing page
   must never show a "[COMPANY NUMBER]" placeholder. No VAT number is shown
   because none is recorded (see vendor.ts).

   Small print is text-ink-2. It used to be text-ink-3, which is 4.15:1 in light
   mode and is named as a known failure in the Accessibility Statement.

   Contact is "/#request-access", not "#request-access", so it also works from a
   policy page. On the landing page itself the two behave identically. */
export default function Footer() {
  const registration = [
    `TMS Wizzard is a trading name of ${VENDOR.legalName}, registered in England and Wales`,
    VENDOR.companyNumber ? `company number ${VENDOR.companyNumber}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <footer className="border-t border-line bg-surface">
      <Container className="py-6 text-xs text-ink-2">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2">
            <span className="h-4 w-4 rounded bg-line-strong" aria-hidden />
            TMS Wizzard · Cloud transport management
          </div>
          <nav className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Footer">
            <Link href="/signup" className="hover:text-ink">
              Get started
            </Link>
            <a href="/#request-access" className="hover:text-ink">
              Contact
            </a>
            <Link href="/terms" className="hover:text-ink">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link href="/cookies" className="hover:text-ink">
              Cookies
            </Link>
            <Link href="/accessibility" className="hover:text-ink">
              Accessibility
            </Link>
            <Link href={LEGAL_INDEX_PATH} className="hover:text-ink">
              All policies
            </Link>
          </nav>
        </div>
        <p className="mt-4 border-t border-line pt-4">
          {registration}. Registered office: {VENDOR.addressLines.join(", ")}.{" "}
          <a href={`mailto:${VENDOR.email}`} className="underline hover:text-ink">
            {VENDOR.email}
          </a>
        </p>
      </Container>
    </footer>
  );
}
