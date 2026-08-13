"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createClient } from "../../lib/supabase/browser";

type PodStatus =
  | "pending"
  | "delivered"
  | "part_delivered"
  | "refused"
  | "damaged"
  | "failed";

type Job = {
  id: string;
  reference: string | null;
  customer_id?: string | null;
  status?: string | null;
};

type Customer = {
  id: string;
  name: string | null;
};

type JobStop = {
  id: string;
  tenant_id: string;
  job_id: string;
  stop_order: number | null;
  type: string | null;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  planned_at: string | null;
  status: string | null;
  recipient_name: string | null;
  delivered_at: string | null;
  pod_notes: string | null;
  pod_status: string | null;
  pod_photo_url: string | null;
  pod_document_url: string | null;
  pod_updated_at: string | null;
};

type PodRecord = {
  id: string;
  tenant_id: string;
  job_id: string | null;
  stop_id: string | null;
  job_stop_id: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  pod_status: PodStatus | null;
  recipient_name: string | null;
  signed_by: string | null;
  delivered_at: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_metres: number | null;
  notes: string | null;
  damaged: boolean | null;
  damage_notes: string | null;
  refused: boolean | null;
  refusal_reason: string | null;
  signature_path: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type PodFile = {
  id: string;
  pod_id: string;
  file_type: "photo" | "signature" | "document" | null;
  storage_bucket: string | null;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  created_at: string | null;
};

type PodFileWithUrl = PodFile & {
  signedUrl: string | null;
};

type PodRow = {
  stop: JobStop;
  job: Job | null;
  customer: Customer | null;
  pod: PodRecord | null;
};

type FilterType =
  | "all"
  | "awaiting"
  | "delivered"
  | "damaged"
  | "refused";

export default function PodPage() {
  const supabase = useMemo(() => createClient(), []);

  const [tenantId, setTenantId] = useState<string | null>(null);

  const [stops, setStops] = useState<JobStop[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pods, setPods] = useState<PodRecord[]>([]);

  const [selectedPod, setSelectedPod] = useState<PodRecord | null>(null);
  const [selectedStop, setSelectedStop] = useState<JobStop | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<PodFileWithUrl[]>([]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState("");

  const getTenantId = useCallback(async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      throw userError;
    }

    if (!user) {
      window.location.href = "/";
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError) {
      throw profileError;
    }

    if (!profile?.tenant_id) {
      throw new Error(
        "Your account is not linked to a TMS Wizzard tenant."
      );
    }

    return profile.tenant_id as string;
  }, [supabase]);

  const loadData = useCallback(
    async (resolvedTenantId: string) => {
      setLoading(true);
      setMessage("");

      try {
        const [
          stopsResult,
          jobsResult,
          customersResult,
          podsResult,
        ] = await Promise.all([
          supabase
            .from("job_stops")
            .select(
              `
              id,
              tenant_id,
              job_id,
              stop_order,
              type,
              address_line,
              city,
              postcode,
              planned_at,
              status,
              recipient_name,
              delivered_at,
              pod_notes,
              pod_status,
              pod_photo_url,
              pod_document_url,
              pod_updated_at
            `
            )
            .eq("tenant_id", resolvedTenantId)
            .eq("type", "delivery")
            .order("planned_at", { ascending: false }),

          supabase
            .from("jobs")
            .select(
              `
              id,
              reference,
              customer_id,
              status
            `
            )
            .eq("tenant_id", resolvedTenantId),

          supabase
            .from("customers")
            .select(
              `
              id,
              name
            `
            )
            .eq("tenant_id", resolvedTenantId),

          supabase
            .from("pod_records")
            .select(
              `
              id,
              tenant_id,
              job_id,
              stop_id,
              job_stop_id,
              driver_id,
              vehicle_id,
              pod_status,
              recipient_name,
              signed_by,
              delivered_at,
              latitude,
              longitude,
              location_accuracy_metres,
              notes,
              damaged,
              damage_notes,
              refused,
              refusal_reason,
              signature_path,
              created_at,
              updated_at
            `
            )
            .eq("tenant_id", resolvedTenantId)
            .order("created_at", { ascending: false }),
        ]);

        const firstError =
          stopsResult.error ||
          jobsResult.error ||
          customersResult.error ||
          podsResult.error;

        if (firstError) {
          throw firstError;
        }

        setStops((stopsResult.data ?? []) as JobStop[]);
        setJobs((jobsResult.data ?? []) as Job[]);
        setCustomers((customersResult.data ?? []) as Customer[]);
        setPods((podsResult.data ?? []) as PodRecord[]);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to load POD information."
        );
      } finally {
        setLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    async function initialise() {
      try {
        const resolvedTenantId = await getTenantId();

        if (!resolvedTenantId) {
          return;
        }

        setTenantId(resolvedTenantId);
        await loadData(resolvedTenantId);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to initialise POD."
        );

        setLoading(false);
      }
    }

    void initialise();
  }, [getTenantId, loadData]);

  const rows = useMemo<PodRow[]>(() => {
    return stops.map((stop) => {
      const job =
        jobs.find((item) => item.id === stop.job_id) ?? null;

      const customer =
        customers.find(
          (item) => item.id === job?.customer_id
        ) ?? null;

      const pod =
        pods.find(
          (item) =>
            item.stop_id === stop.id ||
            item.job_stop_id === stop.id
        ) ?? null;

      return {
        stop,
        job,
        customer,
        pod,
      };
    });
  }, [stops, jobs, customers, pods]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();

    return rows.filter((row) => {
      const effectiveStatus =
        row.pod?.pod_status ??
        row.stop.pod_status ??
        row.stop.status ??
        "pending";

      const matchesFilter =
        filter === "all" ||
        (filter === "awaiting" &&
          ![
            "delivered",
            "damaged",
            "refused",
          ].includes(effectiveStatus)) ||
        (filter === "delivered" &&
          effectiveStatus === "delivered") ||
        (filter === "damaged" &&
          (effectiveStatus === "damaged" ||
            row.pod?.damaged === true)) ||
        (filter === "refused" &&
          (effectiveStatus === "refused" ||
            row.pod?.refused === true));

      if (!matchesFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        row.job?.reference,
        row.customer?.name,
        row.stop.address_line,
        row.stop.city,
        row.stop.postcode,
        row.pod?.recipient_name,
        row.stop.recipient_name,
        effectiveStatus,
      ]
        .filter(Boolean)
        .some((value) =>
          String(value).toLowerCase().includes(query)
        );
    });
  }, [rows, search, filter]);

  const stats = useMemo(() => {
    let awaiting = 0;
    let delivered = 0;
    let damaged = 0;
    let refused = 0;

    rows.forEach((row) => {
      const status =
        row.pod?.pod_status ??
        row.stop.pod_status ??
        row.stop.status ??
        "pending";

      if (
        status === "damaged" ||
        row.pod?.damaged
      ) {
        damaged += 1;
        return;
      }

      if (
        status === "refused" ||
        row.pod?.refused
      ) {
        refused += 1;
        return;
      }

      if (status === "delivered") {
        delivered += 1;
        return;
      }

      awaiting += 1;
    });

    return {
      awaiting,
      delivered,
      damaged,
      refused,
    };
  }, [rows]);

  async function openPod(row: PodRow) {
    setSelectedStop(row.stop);
    setSelectedJob(row.job);
    setSelectedPod(row.pod);
    setSelectedFiles([]);

    if (!row.pod) {
      return;
    }

    setDetailLoading(true);
    setMessage("");

    try {
      const { data, error } = await supabase
        .from("pod_files")
        .select(
          `
          id,
          pod_id,
          file_type,
          storage_bucket,
          storage_path,
          original_filename,
          mime_type,
          created_at
        `
        )
        .eq("pod_id", row.pod.id)
        .eq("tenant_id", row.pod.tenant_id)
        .order("created_at", { ascending: true });

      if (error) {
        throw error;
      }

      const files = (data ?? []) as PodFile[];

      const filesWithUrls = await Promise.all(
        files.map(async (file) => {
          if (!file.storage_path) {
            return {
              ...file,
              signedUrl: null,
            };
          }

          const bucket =
            file.storage_bucket || "pod-files";

          const { data: signedData, error: signedError } =
            await supabase.storage
              .from(bucket)
              .createSignedUrl(
                file.storage_path,
                60 * 15
              );

          if (signedError) {
            console.error(
              "Unable to create POD signed URL",
              signedError
            );

            return {
              ...file,
              signedUrl: null,
            };
          }

          return {
            ...file,
            signedUrl:
              signedData.signedUrl ?? null,
          };
        })
      );

      setSelectedFiles(filesWithUrls);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to open POD files."
      );
    } finally {
      setDetailLoading(false);
    }
  }

  function closePod() {
    setSelectedPod(null);
    setSelectedStop(null);
    setSelectedJob(null);
    setSelectedFiles([]);
  }

  async function refresh() {
    if (!tenantId) {
      return;
    }

    await loadData(tenantId);
  }

  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>
              Proof of Delivery
            </p>

            <h1 style={styles.title}>
              POD Management
            </h1>

            <p style={styles.subtitle}>
              Monitor outstanding deliveries,
              completed PODs, recipient details,
              photographs, signatures and delivery
              exceptions.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refresh()}
            style={styles.refreshButton}
          >
            Refresh
          </button>
        </header>

        {message ? (
          <div style={styles.message}>
            {message}
          </div>
        ) : null}

        <section style={styles.statsGrid}>
          <StatCard
            label="Awaiting POD"
            value={stats.awaiting}
          />

          <StatCard
            label="Delivered"
            value={stats.delivered}
          />

          <StatCard
            label="Damaged"
            value={stats.damaged}
          />

          <StatCard
            label="Refused"
            value={stats.refused}
          />
        </section>

        <section style={styles.mainCard}>
          <div style={styles.toolbar}>
            <input
              type="search"
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
              placeholder="Search job, customer, postcode or recipient..."
              style={styles.search}
            />

            <select
              value={filter}
              onChange={(event) =>
                setFilter(
                  event.target.value as FilterType
                )
              }
              style={styles.select}
            >
              <option value="all">
                All Deliveries
              </option>

              <option value="awaiting">
                Awaiting POD
              </option>

              <option value="delivered">
                Delivered
              </option>

              <option value="damaged">
                Damaged
              </option>

              <option value="refused">
                Refused
              </option>
            </select>
          </div>

          {loading ? (
            <div style={styles.empty}>
              Loading POD records...
            </div>
          ) : filteredRows.length === 0 ? (
            <div style={styles.empty}>
              No POD records match your search.
            </div>
          ) : (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>
                      Job
                    </th>

                    <th style={styles.th}>
                      Customer
                    </th>

                    <th style={styles.th}>
                      Delivery
                    </th>

                    <th style={styles.th}>
                      Planned
                    </th>

                    <th style={styles.th}>
                      Recipient
                    </th>

                    <th style={styles.th}>
                      Status
                    </th>

                    <th style={styles.th}>
                      Delivered
                    </th>

                    <th style={styles.th}>
                      POD
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filteredRows.map((row) => {
                    const status =
                      row.pod?.pod_status ??
                      row.stop.pod_status ??
                      row.stop.status ??
                      "pending";

                    const recipient =
                      row.pod?.recipient_name ??
                      row.pod?.signed_by ??
                      row.stop.recipient_name ??
                      "—";

                    const deliveredAt =
                      row.pod?.delivered_at ??
                      row.stop.delivered_at;

                    return (
                      <tr key={row.stop.id}>
                        <td style={styles.td}>
                          <strong>
                            {row.job?.reference ??
                              "—"}
                          </strong>
                        </td>

                        <td style={styles.td}>
                          {row.customer?.name ??
                            "—"}
                        </td>

                        <td style={styles.td}>
                          <strong>
                            {row.stop.address_line ??
                              "Delivery"}
                          </strong>

                          <div style={styles.muted}>
                            {[
                              row.stop.city,
                              row.stop.postcode,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </div>
                        </td>

                        <td style={styles.td}>
                          {formatDateTime(
                            row.stop.planned_at
                          )}
                        </td>

                        <td style={styles.td}>
                          {recipient}
                        </td>

                        <td style={styles.td}>
                          <span
                            style={statusStyle(
                              status,
                              row.pod
                            )}
                          >
                            {formatStatus(status)}
                          </span>
                        </td>

                        <td style={styles.td}>
                          {formatDateTime(
                            deliveredAt
                          )}
                        </td>

                        <td style={styles.td}>
                          {row.pod ? (
                            <button
                              type="button"
                              onClick={() =>
                                void openPod(row)
                              }
                              style={
                                styles.viewButton
                              }
                            >
                              View POD
                            </button>
                          ) : (
                            <span
                              style={
                                styles.awaitingText
                              }
                            >
                              Awaiting
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selectedStop ? (
          <div
            style={styles.modalBackdrop}
            onClick={closePod}
          >
            <div
              style={styles.modal}
              onClick={(event) =>
                event.stopPropagation()
              }
            >
              <div style={styles.modalHeader}>
                <div>
                  <p style={styles.eyebrow}>
                    POD Details
                  </p>

                  <h2 style={styles.modalTitle}>
                    {selectedJob?.reference ??
                      "Delivery POD"}
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={closePod}
                  style={styles.closeButton}
                >
                  ×
                </button>
              </div>

              <section
                style={styles.deliverySummary}
              >
                <strong>
                  {selectedStop.address_line ??
                    "Delivery"}
                </strong>

                <p style={styles.modalMuted}>
                  {[
                    selectedStop.city,
                    selectedStop.postcode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </section>

              {!selectedPod ? (
                <div style={styles.empty}>
                  POD has not yet been submitted for
                  this delivery.
                </div>
              ) : (
                <>
                  <div
                    style={styles.detailGrid}
                  >
                    <DetailItem
                      label="Status"
                      value={formatStatus(
                        selectedPod.pod_status ??
                          "pending"
                      )}
                    />

                    <DetailItem
                      label="Recipient"
                      value={
                        selectedPod.recipient_name ??
                        selectedPod.signed_by ??
                        "Not recorded"
                      }
                    />

                    <DetailItem
                      label="Delivered"
                      value={formatDateTime(
                        selectedPod.delivered_at
                      )}
                    />

                    <DetailItem
                      label="GPS"
                      value={
                        selectedPod.latitude !==
                          null &&
                        selectedPod.longitude !==
                          null
                          ? `${selectedPod.latitude.toFixed(
                              6
                            )}, ${selectedPod.longitude.toFixed(
                              6
                            )}`
                          : "Not captured"
                      }
                    />

                    <DetailItem
                      label="GPS accuracy"
                      value={
                        selectedPod.location_accuracy_metres !==
                        null
                          ? `${Math.round(
                              selectedPod.location_accuracy_metres
                            )} metres`
                          : "Not recorded"
                      }
                    />
                  </div>

                  {selectedPod.notes ? (
                    <DetailSection
                      title="Delivery Notes"
                    >
                      <p style={styles.detailText}>
                        {selectedPod.notes}
                      </p>
                    </DetailSection>
                  ) : null}

                  {selectedPod.damaged ? (
                    <DetailSection
                      title="Damage Report"
                    >
                      <div
                        style={
                          styles.exceptionBox
                        }
                      >
                        <strong>
                          Goods marked as damaged
                        </strong>

                        <p>
                          {selectedPod.damage_notes ||
                            "No additional damage notes recorded."}
                        </p>
                      </div>
                    </DetailSection>
                  ) : null}

                  {selectedPod.refused ? (
                    <DetailSection
                      title="Refused Delivery"
                    >
                      <div
                        style={
                          styles.exceptionBox
                        }
                      >
                        <strong>
                          Delivery refused
                        </strong>

                        <p>
                          {selectedPod.refusal_reason ||
                            "No refusal reason recorded."}
                        </p>
                      </div>
                    </DetailSection>
                  ) : null}

                  <DetailSection
                    title="POD Files"
                  >
                    {detailLoading ? (
                      <div style={styles.empty}>
                        Loading POD files...
                      </div>
                    ) : selectedFiles.length ===
                      0 ? (
                      <p style={styles.modalMuted}>
                        No POD files have been
                        uploaded.
                      </p>
                    ) : (
                      <div
                        style={
                          styles.fileGrid
                        }
                      >
                        {selectedFiles.map(
                          (file) => (
                            <PodFileCard
                              key={file.id}
                              file={file}
                            />
                          )
                        )}
                      </div>
                    )}
                  </DetailSection>

                  {selectedPod.latitude !==
                    null &&
                  selectedPod.longitude !==
                    null ? (
                    <a
                      href={`https://www.google.com/maps?q=${selectedPod.latitude},${selectedPod.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={styles.mapsButton}
                    >
                      Open Delivery Location in
                      Maps
                    </a>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div style={styles.statCard}>
      <span style={styles.statLabel}>
        {label}
      </span>

      <strong style={styles.statValue}>
        {value}
      </strong>
    </div>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div style={styles.detailItem}>
      <span style={styles.detailLabel}>
        {label}
      </span>

      <strong style={styles.detailValue}>
        {value}
      </strong>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={styles.detailSection}>
      <h3 style={styles.detailSectionTitle}>
        {title}
      </h3>

      {children}
    </section>
  );
}

function PodFileCard({
  file,
}: {
  file: PodFileWithUrl;
}) {
  const isImage =
    file.mime_type?.startsWith("image/") ||
    file.file_type === "photo" ||
    file.file_type === "signature";

  const title =
    file.file_type === "signature"
      ? "Signature"
      : file.file_type === "photo"
        ? "Delivery Photo"
        : "Document";

  return (
    <div style={styles.fileCard}>
      <strong style={styles.fileTitle}>
        {title}
      </strong>

      {file.signedUrl && isImage ? (
        <img
          src={file.signedUrl}
          alt={title}
          style={styles.fileImage}
        />
      ) : null}

      <p style={styles.fileName}>
        {file.original_filename ||
          file.storage_path ||
          "POD file"}
      </p>

      {file.signedUrl ? (
        <a
          href={file.signedUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.fileButton}
        >
          {file.file_type === "document"
            ? "Open Document"
            : "View Full Size"}
        </a>
      ) : (
        <span style={styles.unavailable}>
          File unavailable
        </span>
      )}
    </div>
  );
}

function formatDateTime(
  value: string | null | undefined
) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatStatus(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );
}

function statusStyle(
  status: string,
  pod: PodRecord | null
): CSSProperties {
  if (
    status === "refused" ||
    pod?.refused
  ) {
    return {
      ...styles.statusBase,
      background: "#fee2e2",
      color: "#991b1b",
    };
  }

  if (
    status === "damaged" ||
    pod?.damaged
  ) {
    return {
      ...styles.statusBase,
      background: "#ffedd5",
      color: "#9a3412",
    };
  }

  if (status === "delivered") {
    return {
      ...styles.statusBase,
      background: "#dcfce7",
      color: "#166534",
    };
  }

  return {
    ...styles.statusBase,
    background: "#fef3c7",
    color: "#92400e",
  };
}

const styles: Record<
  string,
  CSSProperties
> = {
  page: {
    minHeight: "100vh",
    background: "#f8fafc",
    color: "#0f172a",
    padding: "32px 20px 60px",
  },

  container: {
    width: "100%",
    maxWidth: 1450,
    margin: "0 auto",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 20,
    flexWrap: "wrap",
    marginBottom: 24,
  },

  eyebrow: {
    margin: "0 0 6px",
    color: "#2563eb",
    fontSize: 12,
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.09em",
  },

  title: {
    margin: 0,
    fontSize: "clamp(32px, 5vw, 48px)",
    letterSpacing: "-0.04em",
  },

  subtitle: {
    maxWidth: 760,
    margin: "8px 0 0",
    color: "#64748b",
    fontSize: 16,
    lineHeight: 1.6,
  },

  refreshButton: {
    border: "1px solid #cbd5e1",
    borderRadius: 11,
    background: "#ffffff",
    color: "#0f172a",
    padding: "11px 16px",
    fontWeight: 800,
    cursor: "pointer",
  },

  message: {
    padding: "13px 16px",
    borderRadius: 12,
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
    marginBottom: 20,
  },

  statsGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
    marginBottom: 24,
  },

  statCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 18,
    padding: 20,
    boxShadow:
      "0 8px 24px rgba(15,23,42,0.05)",
  },

  statLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 13,
    fontWeight: 800,
  },

  statValue: {
    display: "block",
    marginTop: 7,
    fontSize: 30,
  },

  mainCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 20,
    padding: 24,
    boxShadow:
      "0 12px 32px rgba(15,23,42,0.06)",
  },

  toolbar: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    flexWrap: "wrap",
    marginBottom: 20,
  },

  search: {
    flex: "1 1 360px",
    border: "1px solid #cbd5e1",
    borderRadius: 11,
    padding: "11px 13px",
    fontSize: 14,
  },

  select: {
    minWidth: 180,
    border: "1px solid #cbd5e1",
    borderRadius: 11,
    padding: "11px 13px",
    fontSize: 14,
    background: "#ffffff",
  },

  tableWrapper: {
    overflowX: "auto",
  },

  table: {
    width: "100%",
    minWidth: 1100,
    borderCollapse: "collapse",
  },

  th: {
    textAlign: "left",
    padding: "12px 10px",
    borderBottom: "1px solid #e2e8f0",
    color: "#64748b",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },

  td: {
    padding: "15px 10px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "top",
    fontSize: 14,
  },

  muted: {
    marginTop: 4,
    color: "#94a3b8",
    fontSize: 12,
  },

  statusBase: {
    display: "inline-flex",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
  },

  viewButton: {
    border: "none",
    borderRadius: 9,
    padding: "8px 11px",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 800,
    cursor: "pointer",
  },

  awaitingText: {
    color: "#92400e",
    fontWeight: 700,
  },

  empty: {
    padding: "50px 20px",
    textAlign: "center",
    color: "#64748b",
  },

  modalBackdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 2000,
    background: "rgba(15,23,42,0.7)",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "30px 14px",
    overflowY: "auto",
  },

  modal: {
    width: "100%",
    maxWidth: 850,
    background: "#ffffff",
    borderRadius: 22,
    padding: 24,
    boxShadow:
      "0 30px 80px rgba(0,0,0,0.35)",
  },

  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 20,
    alignItems: "flex-start",
    marginBottom: 20,
  },

  modalTitle: {
    margin: 0,
    fontSize: 30,
  },

  closeButton: {
    width: 42,
    height: 42,
    border: "none",
    borderRadius: 999,
    background: "#f1f5f9",
    color: "#0f172a",
    fontSize: 26,
    lineHeight: 1,
    cursor: "pointer",
  },

  deliverySummary: {
    padding: 18,
    borderRadius: 14,
    background: "#0f172a",
    color: "#ffffff",
    marginBottom: 20,
  },

  modalMuted: {
    margin: "5px 0 0",
    color: "#64748b",
  },

  detailGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },

  detailItem: {
    padding: 14,
    borderRadius: 12,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
  },

  detailLabel: {
    display: "block",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 800,
    marginBottom: 5,
  },

  detailValue: {
    fontSize: 14,
  },

  detailSection: {
    marginTop: 24,
    paddingTop: 20,
    borderTop: "1px solid #e2e8f0",
  },

  detailSectionTitle: {
    margin: "0 0 12px",
    fontSize: 18,
  },

  detailText: {
    margin: 0,
    lineHeight: 1.6,
    color: "#334155",
  },

  exceptionBox: {
    padding: 16,
    background: "#fff7ed",
    border: "1px solid #fed7aa",
    color: "#9a3412",
    borderRadius: 12,
  },

  fileGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
  },

  fileCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    padding: 14,
    background: "#f8fafc",
  },

  fileTitle: {
    display: "block",
    marginBottom: 10,
  },

  fileImage: {
    width: "100%",
    height: 190,
    objectFit: "contain",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
  },

  fileName: {
    color: "#64748b",
    fontSize: 12,
    overflowWrap: "anywhere",
  },

  fileButton: {
    display: "block",
    textAlign: "center",
    textDecoration: "none",
    background: "#2563eb",
    color: "#ffffff",
    borderRadius: 9,
    padding: "9px 11px",
    fontWeight: 800,
    fontSize: 13,
  },

  unavailable: {
    color: "#991b1b",
    fontSize: 12,
    fontWeight: 700,
  },

  mapsButton: {
    display: "block",
    textAlign: "center",
    textDecoration: "none",
    marginTop: 24,
    borderRadius: 12,
    padding: "13px",
    background: "#0f172a",
    color: "#ffffff",
    fontWeight: 800,
  },
};