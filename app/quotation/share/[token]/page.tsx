import {
  loadQuotationShare,
} from "../../../../lib/quotations/publicShare";

import AcceptanceClient from "./AcceptanceClient";

export const dynamic =
  "force-dynamic";

function money(
  value: unknown,
  currency: string
) {
  return new Intl.NumberFormat(
    "en-GB",
    {
      style: "currency",
      currency:
        currency || "GBP",
    }
  ).format(
    Number(value ?? 0)
  );
}

function customerName(
  customer: unknown
): string {
  if (
    customer &&
    typeof customer ===
      "object" &&
    !Array.isArray(customer) &&
    "name" in customer
  ) {
    return String(
      (
        customer as {
          name?: unknown;
        }
      ).name ?? ""
    );
  }

  if (
    Array.isArray(customer) &&
    customer[0] &&
    typeof customer[0] ===
      "object" &&
    "name" in customer[0]
  ) {
    return String(
      (
        customer[0] as {
          name?: unknown;
        }
      ).name ?? ""
    );
  }

  return "";
}

export default async function QuotationSharePage({
  params,
}: {
  params: Promise<{
    token: string;
  }>;
}) {
  const {
    token,
  } = await params;

  try {
    const rawToken =
      decodeURIComponent(token);

    const {
      share,
      quotation,
      template,
      termsVersion,
    } =
      await loadQuotationShare(
        rawToken,
        true
      );

    const lines =
      Array.isArray(
        quotation.quotation_lines
      )
        ? [
            ...quotation.quotation_lines,
          ].sort(
            (
              a: {
                line_number?: number;
              },
              b: {
                line_number?: number;
              }
            ) =>
              Number(
                a.line_number ?? 0
              ) -
              Number(
                b.line_number ?? 0
              )
          )
        : [];

    const currency =
      quotation.currency_code ||
      "GBP";

    return (
      <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900">
        <div className="mx-auto max-w-5xl space-y-6">
          <section className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-sm text-slate-500">
                  {template?.heading ||
                    "Quotation"}
                </div>

                <h1 className="mt-1 text-3xl font-bold">
                  {quotation.quote_number}
                </h1>

                <p className="mt-2 text-slate-600">
                  {customerName(
                    quotation.customers
                  )}
                </p>
              </div>

              <div className="text-right text-sm">
                <div>
                  Quote date:{" "}
                  {quotation.quote_date}
                </div>

                <div>
                  Valid until:{" "}
                  {quotation.valid_until ||
                    "—"}
                </div>
              </div>
            </div>

            {template?.intro_text && (
              <p className="mt-6 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                {template.intro_text}
              </p>
            )}
          </section>

          <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="border-b border-slate-200 px-6 py-4">
              <h2 className="font-semibold">
                Quotation lines
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-6 py-3">
                      Description
                    </th>

                    <th className="px-4 py-3 text-right">
                      Qty
                    </th>

                    <th className="px-4 py-3 text-right">
                      Rate
                    </th>

                    <th className="px-4 py-3 text-right">
                      VAT
                    </th>

                    <th className="px-6 py-3 text-right">
                      Total
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {lines.map(
                    (
                      line: {
                        id: string;
                        description?: string;
                        quantity?: number;
                        unit_price?: number;
                        vat_rate?: number;
                        line_total?: number;
                      }
                    ) => (
                      <tr
                        key={line.id}
                        className="border-t border-slate-100"
                      >
                        <td className="px-6 py-3">
                          {line.description}
                        </td>

                        <td className="px-4 py-3 text-right">
                          {line.quantity}
                        </td>

                        <td className="px-4 py-3 text-right">
                          {money(
                            line.unit_price,
                            currency
                          )}
                        </td>

                        <td className="px-4 py-3 text-right">
                          {Number(
                            line.vat_rate ??
                              0
                          )}
                          %
                        </td>

                        <td className="px-6 py-3 text-right font-medium">
                          {money(
                            line.line_total,
                            currency
                          )}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            <div className="ml-auto max-w-sm space-y-2 border-t border-slate-200 p-6 text-sm">
              <div className="flex justify-between">
                <span>
                  Subtotal
                </span>

                <span>
                  {money(
                    quotation.subtotal,
                    currency
                  )}
                </span>
              </div>

              <div className="flex justify-between">
                <span>
                  VAT
                </span>

                <span>
                  {money(
                    quotation.vat_total,
                    currency
                  )}
                </span>
              </div>

              <div className="flex justify-between text-lg font-bold">
                <span>
                  Total
                </span>

                <span>
                  {money(
                    quotation.total,
                    currency
                  )}
                </span>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm md:p-8">
            {!termsVersion ? (
              <div className="rounded-lg border border-red-300 bg-red-50 p-4">
                This quotation does not have a valid Terms &amp; Conditions snapshot. Please contact the sender.
              </div>
            ) : (
              <>
                <div className="mb-6">
                  <div className="text-sm text-slate-500">
                    Terms version{" "}
                    {termsVersion.version_number}
                  </div>

                  <h2 className="text-xl font-semibold">
                    {termsVersion.title}
                  </h2>
                </div>

                <AcceptanceClient
                  token={rawToken}
                  clauses={
                    termsVersion.clauses
                  }
                  adrRequired={
                    Boolean(
                      share.adr_required
                    )
                  }
                  adrText={
                    termsVersion.adr_acceptance_text
                  }
                  initialEmail={
                    share.sent_to_email ||
                    ""
                  }
                  alreadyAccepted={
                    Boolean(
                      share.accepted_at
                    )
                  }
                  alreadyDeclined={
                    Boolean(
                      share.declined_at
                    )
                  }
                />
              </>
            )}
          </section>

          {template?.footer_text && (
            <footer className="pb-8 text-center text-xs text-slate-500">
              {template.footer_text}
            </footer>
          )}
        </div>
      </main>
    );
  }
  catch (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="max-w-lg rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">
            Quotation unavailable
          </h1>

          <p className="mt-3 text-sm text-slate-600">
            {error instanceof Error
              ? error.message
              : "Unable to load quotation."}
          </p>
        </div>
      </main>
    );
  }
}