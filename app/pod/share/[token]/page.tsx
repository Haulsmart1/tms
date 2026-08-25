import { notFound } from "next/navigation";
import { verifyPodShareToken } from "../../../../lib/pod/shareToken";
import { loadSharedPod } from "../../../../lib/pod/shareData";
import ShareActions from "./ShareActions";
import { Lock } from "lucide-react";

export const dynamic = "force-dynamic";

function formatDateTime(
  value: string | null
) {
  if (!value) {
    return "—";
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

function formatExpiry(
  unixSeconds: number
) {
  const date =
    new Date(
      unixSeconds * 1000
    );

  return date.toLocaleString(
    "en-GB",
    {
      timeZone:
        "Europe/London",
    }
  );
}

function formatLabel(
  value: string | null
) {
  if (!value) {
    return "—";
  }

  return value
    .replaceAll("_", " ")
    .replace(
      /\b\w/g,
      (character) =>
        character.toUpperCase()
    );
}

function statusClasses(
  value: string | null
) {
  const normalized =
    value?.toLowerCase() ?? "";

  if (
    normalized === "completed" ||
    normalized === "delivered"
  ) {
    return "border-emerald-500/40 bg-emerald-500/15 text-emerald-300";
  }

  if (
    normalized === "pending" ||
    normalized === "planned"
  ) {
    return "border-amber-500/40 bg-amber-500/15 text-amber-300";
  }

  return "border-slate-600 bg-slate-800 text-slate-200";
}

function Detail({
  label,
  children,
}: {
  label: string;
  children:
    React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-bold text-slate-200">
        {label}
      </div>

      <div className="text-sm leading-6 text-white">
        {children}
      </div>
    </div>
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

  const allEvidence =
    pod.stops.flatMap(
      (stop) =>
        stop.evidence.map(
          (item) => ({
            ...item,
            stopOrder:
              stop.stopOrder,
            stopType:
              stop.type,
          })
        )
    );

  const photos =
    allEvidence.filter(
      (item) =>
        item.mimeType?.startsWith(
          "image/"
        )
    );

  const documents =
    allEvidence.filter(
      (item) =>
        !item.mimeType?.startsWith(
          "image/"
        )
    );

  return (
    <main className="min-h-screen bg-[#0b1220] text-white">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:px-10 print:max-w-none print:bg-white print:px-0 print:py-0 print:text-black">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-blue-400 print:text-black">
              ADR Carriers
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-white print:text-black">
              Proof of Delivery
            </h1>
          </div>

          <ShareActions
            pdfUrl={pdfUrl}
          />
        </header>

        <section className="mb-5 rounded-xl border border-slate-700 bg-[#111c2e] p-5 shadow-sm print:border-slate-300 print:bg-white">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-5 md:border-r md:border-slate-700 md:pr-8 print:md:border-slate-300">
              <Detail label="Job reference">
                {pod.reference}
              </Detail>

              <Detail label="Customer reference">
                {pod.customerReference ||
                  "—"}
              </Detail>
            </div>

            <div className="space-y-5 md:pl-3">
              <Detail label="Customer">
                {pod.customerName}
              </Detail>

              <div>
                <div className="mb-1 text-xs font-bold text-slate-200">
                  Status
                </div>

                <span
                  className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-bold ${statusClasses(
                    pod.status
                  )}`}
                >
                  {formatLabel(
                    pod.status
                  )}
                </span>
              </div>
            </div>
          </div>
        </section>

        <div className="mb-5 grid gap-4 lg:grid-cols-2">
          {pod.stops.map(
            (stop) => (
              <section
                key={stop.id}
                className="break-inside-avoid rounded-xl border border-slate-700 bg-[#111c2e] p-5 shadow-sm print:border-slate-300 print:bg-white"
              >
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                    {stop.stopOrder}
                  </span>

                  <h2 className="text-lg font-bold text-white print:text-black">
                    Step{" "}
                    {stop.stopOrder}
                    {" — "}
                    {formatLabel(
                      stop.type
                    )}
                  </h2>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-5 sm:border-r sm:border-slate-700 sm:pr-5 print:sm:border-slate-300">
                    <Detail label="Address">
                      {[
                        stop.address,
                        stop.city,
                        stop.postcode,
                      ]
                        .filter(
                          Boolean
                        )
                        .join(", ")}
                    </Detail>

                    <Detail label="Delivered">
                      {formatDateTime(
                        stop.deliveredAt
                      )}
                    </Detail>

                    <Detail label="POD notes">
                      <span className="whitespace-pre-wrap">
                        {stop.podNotes ||
                          "—"}
                      </span>
                    </Detail>
                  </div>

                  <div className="space-y-5">
                    <Detail label="Recipient">
                      {stop.recipientName ||
                        "—"}
                    </Detail>

                    <div>
                      <div className="mb-1 text-xs font-bold text-slate-200">
                        POD status
                      </div>

                      <span
                        className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-bold ${statusClasses(
                          stop.podStatus
                        )}`}
                      >
                        {formatLabel(
                          stop.podStatus
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )
          )}
        </div>

        <section className="mb-5 rounded-xl border border-slate-700 bg-[#111c2e] p-5 shadow-sm print:border-slate-300 print:bg-white">
          <h2 className="mb-4 text-xl font-bold text-white print:text-black">
            POD Evidence
          </h2>

          {allEvidence.length ===
          0 ? (
            <div className="rounded-lg border border-dashed border-slate-600 p-5 text-sm text-slate-300 print:text-black">
              No POD evidence has been uploaded.
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
              <div className="grid gap-4 sm:grid-cols-2">
                {photos.map(
                  (item) => (
                    <div
                      key={item.id}
                      className="overflow-hidden rounded-lg border border-slate-700 bg-[#0b1220] print:border-slate-300 print:bg-white"
                    >
                      {item.signedUrl ? (
                        <a
                          href={
                            item.signedUrl
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={
                              item.signedUrl
                            }
                            alt={
                              item.filename
                            }
                            className="h-72 w-full object-contain"
                          />
                        </a>
                      ) : null}

                      <div className="border-t border-slate-700 p-3 print:border-slate-300">
                        <div className="mb-1 text-xs font-semibold uppercase text-slate-400">
                          Photo
                        </div>

                        <div className="break-all text-sm font-semibold text-white print:text-black">
                          {item.filename}
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>

              <div className="space-y-5">
                {documents.length >
                0 ? (
                  <div>
                    <div className="mb-3 text-sm font-bold text-white print:text-black">
                      Documents
                    </div>

                    <div className="space-y-2">
                      {documents.map(
                        (item) => (
                          <div
                            key={
                              item.id
                            }
                            className="rounded-lg border border-slate-700 bg-[#0b1220] p-3 print:border-slate-300 print:bg-white"
                          >
                            <div className="mb-1 text-xs text-slate-400">
                              Stop{" "}
                              {
                                item.stopOrder
                              }{" "}
                              ·{" "}
                              {formatLabel(
                                item.stopType
                              )}
                            </div>

                            {item.signedUrl ? (
                              <a
                                href={
                                  item.signedUrl
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-sm font-bold text-blue-400 underline decoration-blue-400/50 underline-offset-2 hover:text-blue-300 print:text-black"
                              >
                                {
                                  item.filename
                                }
                              </a>
                            ) : (
                              <div className="break-all text-sm font-bold text-white print:text-black">
                                {
                                  item.filename
                                }
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ) : null}

                {photos.length >
                0 ? (
                  <div>
                    <div className="mb-3 text-sm font-bold text-white print:text-black">
                      Photo files
                    </div>

                    <div className="space-y-2">
                      {photos.map(
                        (item) => (
                          <div
                            key={
                              item.id
                            }
                            className="rounded-lg border border-slate-700 bg-[#0b1220] p-3 print:border-slate-300 print:bg-white"
                          >
                            {item.signedUrl ? (
                              <a
                                href={
                                  item.signedUrl
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all text-sm font-bold text-blue-400 underline decoration-blue-400/50 underline-offset-2 hover:text-blue-300 print:text-black"
                              >
                                {
                                  item.filename
                                }
                              </a>
                            ) : (
                              <div className="break-all text-sm font-bold text-white print:text-black">
                                {
                                  item.filename
                                }
                              </div>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </section>

        <footer className="rounded-xl border border-slate-700 bg-[#111c2e] p-5 print:border-slate-300 print:bg-white">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-blue-500 text-blue-400 print:border-slate-300 print:text-black">
              <Lock size={18} aria-hidden />
            </div>

            <div>
              <div className="font-semibold text-white print:text-black">
                This POD link is secure and accessible only to anyone who has this link.
              </div>

              <div className="mt-1 text-sm text-slate-300 print:text-black">
                This link expires automatically on{" "}
                {formatExpiry(
                  payload.expiresAt
                )}.
              </div>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
