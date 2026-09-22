import type { Metadata } from "next";
import Link from "next/link";
import Container from "../../components/Container";
import LegalShell from "../../components/legal/LegalShell";
import { allLegalDocuments } from "../../lib/legal/documents";
import { documentStatus } from "../../lib/legal/text";

/* The index of every published policy. The footer links here as "All
   policies", so each document is reachable without ten footer links. */
export const metadata: Metadata = {
  title: "Legal and policies | TMS Wizzard",
  description:
    "Terms, privacy, cookies, cancellation and refunds, data processing, accessibility, support, acceptable use, sub-processors and security for TMS Wizzard.",
};

export default function LegalIndexPage() {
  const documents = allLegalDocuments();

  return (
    <LegalShell>
      <Container className="py-10 lg:py-14">
        <h1 className="text-2xl font-semibold text-ink">Legal and policies</h1>
        <p className="mt-2 max-w-2xl text-md text-ink-2">
          The documents that govern your use of TMS Wizzard and explain how we handle data.
        </p>

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
