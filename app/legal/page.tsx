import type { Metadata } from "next";
import { publicMetadata } from "../../lib/seo/site";
import Link from "next/link";
import Container from "../../components/Container";
import LegalShell from "../../components/legal/LegalShell";
import { PageIntro } from "../../components/landing/Brand";
import { allLegalDocuments } from "../../lib/legal/documents";
import { documentStatus } from "../../lib/legal/text";

/* The index of every published policy. The footer links here as "All
   policies", so each document is reachable without ten footer links. */
export const metadata: Metadata = publicMetadata("/legal", "Legal and policies | TMS Wizard",
  "Terms, privacy, cookies, cancellation, data processing, accessibility, support and security policies for TMS Wizard.");

export default function LegalIndexPage() {
  const documents = allLegalDocuments();

  return (
    <LegalShell>
      <Container className="brand-page-container">
        <PageIntro label="POLICIES & INFORMATION" title="Legal and policies"><p>The documents that govern your use of TMS Wizard and explain how we handle data. Review the terms, policy status and version details before making a decision.</p></PageIntro>

        <ul className="mt-8 grid list-none gap-4 pl-0 sm:grid-cols-2">
          {documents.map((doc) => (
            <li key={doc.path} className="rounded-lg border border-line bg-surface p-5">
              <h2 className="text-md font-semibold text-ink">
                <Link href={doc.path} className="hover:text-primary hover:underline">
                  {doc.title}
                </Link>
              </h2>
              <p className="mt-1 text-base text-ink-2">{doc.summary}</p>
              <p className="mt-3 text-sm text-ink-2">
                {doc.content.versionLine}
                {documentStatus(doc.content).draft ? " Draft, not yet in force." : ""}
              </p>
            </li>
          ))}
        </ul>
      </Container>
    </LegalShell>
  );
}
