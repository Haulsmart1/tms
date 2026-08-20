import { notFound } from "next/navigation";
import { verifyPodShareToken } from "../../../../lib/pod/shareToken";
import { loadSharedPod } from "../../../../lib/pod/shareData";
import ShareActions from "./ShareActions";

export const dynamic = "force-dynamic";

function formatDateTime(
  value: string | null
) {
  if (!value) {
    return "-";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }

  return date.toLocaleString(
    "en-GB",
    {
      timeZone:
        "Europe/London",
    }
  );
}

export default async function PodSharePage({
  params,
}: {
  params: Promise<{
    token: string;
  }>;
}) {
  const { token } =
    await params;

  const decodedToken =
    decodeURIComponent(token);

  const payload =
    verifyPodShareToken(
      decodedToken
    );

  if (!payload) {
    notFound();
  }

  const pod =
    await loadSharedPod(
      payload.tenantId,
      payload.jobId
    );

  if (!pod) {
    notFound();
  }

  const pdfUrl =
    `/api/pod/share/${encodeURIComponent(
      decodedToken
    )}/pdf`;

  return (
    <main className="mx-auto max-w-4xl p-6 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold uppercase text-ink-3">
            ADR Carriers
          </div>

          <h1 className="mt-1 text-2xl font-bold text-ink">
            Proof of Delivery
          </h1>
        </div>

        <ShareActions
          pdfUrl={pdfUrl}
        />
      </div>

      <section className="mb-6 grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2">
        <div>
          <strong>
            Job reference
          </strong>
          <div>
            {pod.reference}
          </div>
        </div>

        <div>
          <strong>
            Customer
          </strong>
          <div>
            {pod.customerName}
          </div>
        </div>

        <div>
          <strong>
            Customer reference
          </strong>
          <div>
            {pod.customerReference ||
              "-"}
          </div>
        </div>

        <div>
          <strong>
            Status
          </strong>
          <div>
            {pod.status ||
              "-"}
          </div>
        </div>
      </section>

      <div className="grid gap-4">
        {pod.stops.map(
          (stop) => (
            <section
              key={stop.id}
              className="break-inside-avoid rounded-lg border border-line bg-surface p-4"
            >
              <h2 className="mb-3 text-lg font-semibold text-ink">
                Stop{" "}
                {stop.stopOrder}{" "}
                ·{" "}
                {stop.type}
              </h2>

              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <strong>
                    Address
                  </strong>
                  <div>
                    {[
                      stop.address,
                      stop.city,
                      stop.postcode,
                    ]
                      .filter(
                        Boolean
                      )
                      .join(
                        ", "
                      )}
                  </div>
                </div>

                <div>
                  <strong>
                    Recipient
                  </strong>
                  <div>
                    {stop.recipientName ||
                      "-"}
                  </div>
                </div>

                <div>
                  <strong>
                    Delivered
                  </strong>
                  <div>
                    {formatDateTime(
                      stop.deliveredAt
                    )}
                  </div>
                </div>

                <div>
                  <strong>
                    POD status
                  </strong>
                  <div>
                    {stop.podStatus ||
                      "-"}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <strong>
                    POD notes
                  </strong>
                  <div className="whitespace-pre-wrap">
                    {stop.podNotes ||
                      "-"}
                  </div>
                </div>
              </div>

              {stop.evidence.length >
              0 ? (
                <div className="mt-4">
                  <h3 className="mb-2 font-semibold text-ink">
                    POD Evidence
                  </h3>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {stop.evidence.map(
                      (
                        item
                      ) => (
                        <div
                          key={
                            item.id
                          }
                          className="rounded-md border border-line p-3"
                        >
                          {item.mimeType?.startsWith(
                            "image/"
                          ) &&
                          item.signedUrl ? (
                            <img
                              src={
                                item.signedUrl
                              }
                              alt={
                                item.filename
                              }
                              className="mb-2 max-h-72 w-full rounded object-contain"
                            />
                          ) : null}

                          <div className="break-all text-sm font-medium">
                            {
                              item.filename
                            }
                          </div>

                          <div className="text-xs text-ink-3">
                            {
                              item.evidenceType
                            }
                          </div>

                          {item.signedUrl ? (
                            <a
                              href={
                                item.signedUrl
                              }
                              target="_blank"
                              rel="noopener noreferrer"
                              className="print:hidden mt-2 inline-block text-sm font-semibold underline"
                            >
                              Open evidence
                            </a>
                          ) : null}
                        </div>
                      )
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          )
        )}
      </div>

      <div className="mt-8 border-t border-line pt-3 text-xs text-ink-3">
        Secure POD supplied by ADR Carriers.
        This sharing link expires automatically.
      </div>
    </main>
  );
}
