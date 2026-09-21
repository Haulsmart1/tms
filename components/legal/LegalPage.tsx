import Link from "next/link";
import Container from "../Container";
import LegalShell from "./LegalShell";
import { getLegalDocument } from "../../lib/legal/documents";
import { LEGAL_INDEX_PATH } from "../../lib/legal/routes";
import { documentStatus, linkify, resolvePlaceholders, sectionId } from "../../lib/legal/text";
import type { LegalBlock, LegalRun } from "../../lib/legal/types";

/* Renders one policy document. Every app/<policy>/page.tsx is this component
   with a path, so the ten pages cannot drift apart in layout or behaviour.

   The WORDS are not written here. They come verbatim from the PDFs in
   docs/TMS POLICIES/ through lib/legal/content/*.json. The only text this file
   adds is page chrome: the draft notice, "On this page" and the back link.

   Body copy is text-ink and secondary copy text-ink-2. text-ink-3 is avoided
   throughout: it is a recorded contrast failure in light mode
   (lib/theme/contrast.test.ts), and the Accessibility Statement rendered by
   this component names exactly that failure. */

function Text({ text, path }: { text: string; path: string }) {
  return (
    <>
      {linkify(resolvePlaceholders(text), path).map((segment, i) =>
        segment.kind === "link" ? (
          segment.href.startsWith("/") ? (
            <Link key={i} href={segment.href} className="text-primary underline hover:text-primary-hover">
              {segment.text}
            </Link>
          ) : (
            <a key={i} href={segment.href} className="text-primary underline hover:text-primary-hover">
              {segment.text}
            </a>
          )
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function Runs({ runs, path }: { runs: LegalRun[]; path: string }) {
  return (
    <>
      {runs.map((run, i) =>
        run.bold ? (
          /* font-semibold, not the UA bold: Plex is loaded up to 600 only, so
             700 would be faux-bolded (see app/layout.tsx). */
          <strong key={i} className="font-semibold text-ink">
            <Text text={run.text} path={path} />
          </strong>
        ) : (
          <Text key={i} text={run.text} path={path} />
        ),
      )}
    </>
  );
}

function Block({ block, path, label }: { block: LegalBlock; path: string; label: string }) {
  if (block.kind === "p") {
    return (
      <p>
        <Runs runs={block.runs} path={path} />
      </p>
    );
  }

  if (block.kind === "ul") {
    return (
      <ul className="list-disc space-y-2 pl-5">
        {block.items.map((item, i) => (
          <li key={i}>
            <Runs runs={item} path={path} />
          </li>
        ))}
      </ul>
    );
  }

  /* Wide tables scroll inside their own box, so the page never scrolls
     sideways on a phone. A scrollable box has to be a labelled, focusable
     region or a keyboard user cannot scroll it. */
  return (
    <div
      className="overflow-x-auto rounded-md border border-line-strong print:overflow-visible"
      tabIndex={0}
      role="region"
      aria-label={`Table: ${label}`}
    >
      {/* Only a table of three or more columns needs a minimum width (and so a
          sideways scroll on a phone). A two-column table wraps and stays
          fully visible. Both class strings are literals so Tailwind sees them. */}
      <table
        className={
          (block.head?.length ?? block.rows[0]?.length ?? 0) >= 3
            ? "w-full min-w-[36rem] border-collapse text-left text-base"
            : "w-full border-collapse text-left text-base"
        }
      >
        {block.head ? (
          <thead className="bg-surface-2">
            <tr>
              {block.head.map((cell, i) => (
                <th key={i} scope="col" className="border-b border-line-strong px-3 py-2 align-bottom font-semibold text-ink">
                  <Text text={cell} path={path} />
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r} className="border-b border-line last:border-b-0">
              {row.map((cell, c) =>
                c === 0 ? (
                  <th key={c} scope="row" className="px-3 py-2 align-top font-medium text-ink">
                    <Text text={cell} path={path} />
                  </th>
                ) : (
                  <td key={c} className="px-3 py-2 align-top">
                    <Text text={cell} path={path} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function LegalPage({ path }: { path: string }) {
  const doc = getLegalDocument(path);
  const { content } = doc;
  const status = documentStatus(content);

  return (
    <LegalShell>
      <Container className="grid gap-10 py-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:py-14">
        <nav aria-label="On this page" className="hidden lg:block print:hidden">
          <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2">
            <p className="text-overline uppercase text-ink-2">On this page</p>
            <ol className="mt-3 list-none space-y-2 pl-0 text-sm">
              {content.sections.map((section) => (
                <li key={section.heading}>
                  <a href={`#${sectionId(section.heading)}`} className="text-ink-2 hover:text-ink hover:underline">
                    {section.heading}
                  </a>
                </li>
              ))}
            </ol>
            <Link href={LEGAL_INDEX_PATH} className="mt-6 inline-block text-sm font-semibold text-primary hover:text-primary-hover">
              All policies
            </Link>
          </div>
        </nav>

        <article className="min-w-0 max-w-3xl text-md text-ink">
          <header>
            <h1 className="text-2xl font-semibold text-ink">{content.title}</h1>
            <p className="mt-2 text-sm text-ink-2">{content.versionLine}</p>
          </header>

          {status.draft ? (
            <div role="note" className="mt-6 rounded-lg border border-warning-border bg-warning-tint p-4 text-sm text-warning-strong">
              <p className="font-semibold">Draft, not yet in force</p>
              <p className="mt-1">
                This document is published for review. Some details are still being confirmed and appear in square brackets
                below: {status.unresolved.join(", ")}.
              </p>
            </div>
          ) : null}

          <address className="mt-6 rounded-lg border border-line bg-surface p-4 text-sm not-italic text-ink-2">
            <p className="font-semibold text-ink">Company details</p>
            {content.company.map((line) => (
              <p key={line} className="mt-1">
                <Text text={line} path={path} />
              </p>
            ))}
          </address>

          <div className="mt-8 space-y-4">
            {content.intro.map((block, i) => (
              <Block key={i} block={block} path={path} label={content.title} />
            ))}
          </div>

          {content.sections.map((section) => (
            <section key={section.heading} aria-labelledby={sectionId(section.heading)} className="mt-10">
              <h2 id={sectionId(section.heading)} className="scroll-mt-6 text-lg font-semibold text-ink">
                {section.heading}
              </h2>
              <div className="mt-4 space-y-4">
                {section.blocks.map((block, i) => (
                  <Block key={i} block={block} path={path} label={section.heading} />
                ))}
              </div>
            </section>
          ))}

          <p className="mt-12 border-t border-line pt-6 text-sm text-ink-2 lg:hidden print:hidden">
            <Link href={LEGAL_INDEX_PATH} className="font-semibold text-primary hover:text-primary-hover">
              All policies
            </Link>
          </p>
        </article>
      </Container>
    </LegalShell>
  );
}
