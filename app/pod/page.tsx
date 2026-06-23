"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../lib/supabase/browser";

const TENANT_ID = "2f7cc0dc-b7fd-4556-92be-445e4b42ddcd";
const POD_BUCKET = "pod-files";

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  fontSize: 14,
  background: "white",
  width: "100%",
  boxSizing: "border-box"
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "white",
  fontWeight: 600,
  cursor: "pointer"
};

const secondaryButtonStyle = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "white",
  color: "#111827",
  fontWeight: 600,
  cursor: "pointer"
};

export default function PodPage() {
  const supabase = createClient();

  const [jobs, setJobs] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [savingStopId, setSavingStopId] = useState(null);
  const [uploadingField, setUploadingField] = useState("");
  const [forms, setForms] = useState<Record<string, any>>({});

  async function loadJobs() {
    setMessage("");

    const { data, error } = await supabase
      .from("jobs")
      .select(`
        id,
        reference,
        status,
        scheduled_date,
        customers (
          name
        ),
        job_stops (
          id,
          stop_order,
          type,
          address_line,
          city,
          postcode,
          status,
          pod_status,
          recipient_name,
          delivered_at,
          pod_notes,
          pod_photo_url,
          pod_document_url,
          pod_updated_at
        )
      `)
      .eq("tenant_id", TENANT_ID)
      .order("created_at", { ascending: false });

    if (error) {
      setMessage(`Load error: ${error.message}`);
      return;
    }

    const normalized = (data || []).map((job: any) => ({
      ...job,
      job_stops: [...(job.job_stops || [])].sort(
        (a, b) => a.stop_order - b.stop_order
      )
    }));

    setJobs(normalized);

    const nextForms: Record<string, any> = {};
    normalized.forEach((job: any) => {
      (job.job_stops || []).forEach((stop: any) => {
        nextForms[stop.id] = {
          recipient_name: stop.recipient_name || "",
          pod_notes: stop.pod_notes || "",
          pod_photo_url: stop.pod_photo_url || "",
          pod_document_url: stop.pod_document_url || ""
        };
      });
    });

    setForms(nextForms);
  }

  useEffect(() => {
    loadJobs();
  }, []);

  function updateForm(stopId: any, field: any, value: any) {
    setForms((current: any) => ({
      ...current,
      [stopId]: {
        recipient_name: current[stopId]?.recipient_name || "",
        pod_notes: current[stopId]?.pod_notes || "",
        pod_photo_url: current[stopId]?.pod_photo_url || "",
        pod_document_url: current[stopId]?.pod_document_url || "",
        [field]: value
      }
    }));
  }

  async function uploadFile(file: any, stopId: any, fieldName: any) {
    if (!file) {
      return;
    }

    setUploadingField(`${stopId}-${fieldName}`);
    setMessage("");

    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const filePath = `${TENANT_ID}/${stopId}/${fieldName}-${Date.now()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(POD_BUCKET)
      .upload(filePath, file, {
        upsert: true
      });

    if (uploadError) {
      setUploadingField("");
      setMessage(`Upload error: ${uploadError.message}`);
      return;
    }

    const { data: publicUrlData } = supabase.storage
      .from(POD_BUCKET)
      .getPublicUrl(filePath);

    const publicUrl = publicUrlData?.publicUrl || "";

    updateForm(stopId, fieldName, publicUrl);

    setUploadingField("");
    setMessage(
      fieldName === "pod_photo_url"
        ? "Photo uploaded."
        : "Document uploaded."
    );
  }

  async function savePod(stopId: any, markDelivered: any) {
    const form = forms[stopId] || {
      recipient_name: "",
      pod_notes: "",
      pod_photo_url: "",
      pod_document_url: ""
    };

    setSavingStopId(stopId);
    setMessage("");

    const updatePayload: Record<string, any> = {
      recipient_name: form.recipient_name.trim() || null,
      pod_notes: form.pod_notes.trim() || null,
      pod_photo_url: form.pod_photo_url.trim() || null,
      pod_document_url: form.pod_document_url.trim() || null,
      pod_updated_at: new Date().toISOString()
    };

    if (markDelivered) {
      updatePayload.delivered_at = new Date().toISOString();
      updatePayload.pod_status = "delivered";
      updatePayload.status = "completed";
    }

    const { error } = await supabase
      .from("job_stops")
      .update(updatePayload)
      .eq("id", stopId)
      .eq("tenant_id", TENANT_ID);

    if (error) {
      setSavingStopId(null);
      setMessage(`Save error: ${error.message}`);
      return;
    }

    if (markDelivered) {
      const job = jobs.find((j: any) =>
        (j.job_stops || []).some((s: any) => s.id === stopId)
      );

      if (job) {
        const { data: deliveryStops, error: deliveryError } = await supabase
          .from("job_stops")
          .select("id, pod_status")
          .eq("tenant_id", TENANT_ID)
          .eq("job_id", job.id)
          .eq("type", "delivery");

        if (!deliveryError) {
          const allDelivered =
            (deliveryStops || []).length > 0 &&
            deliveryStops.every((stop: any) => stop.pod_status === "delivered");

          if (allDelivered) {
            await supabase
              .from("jobs")
              .update({ status: "completed" })
              .eq("id", job.id)
              .eq("tenant_id", TENANT_ID);
          }
        }
      }
    }

    setSavingStopId(null);
    setMessage(markDelivered ? "POD saved and stop delivered." : "POD updated.");
    await loadJobs();
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 30,
        backgroundImage:
          "url('https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d')",
        backgroundSize: "cover",
        backgroundPosition: "center"
      }}
    >
      <div
        style={{
          background: "rgba(0,0,0,0.60)",
          padding: 30,
          borderRadius: 20
        }}
      >
        <div style={{ color: "white", marginBottom: 24 }}>
          <h1 style={{ marginTop: 0, fontSize: 38 }}>POD</h1>
          <p style={{ opacity: 0.85, marginBottom: 0 }}>
            Edit POD, upload photos and delivery documents, and mark delivery stops complete.
          </p>
        </div>

        {message ? (
          <div
            style={{
              marginBottom: 20,
              background: "rgba(255,255,255,0.94)",
              padding: 14,
              borderRadius: 12,
              color: "#111827"
            }}
          >
            {message}
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 18 }}>
          {jobs.map((job: any) => (
            <div
              key={job.id}
              style={{
                background: "rgba(255,255,255,0.95)",
                borderRadius: 16,
                padding: 22,
                boxShadow: "0 10px 30px rgba(0,0,0,0.18)"
              }}
            >
              <div style={{ marginBottom: 14 }}>
                <h2 style={{ margin: "0 0 8px 0" }}>
                  {job.reference} - {job.customers?.name || "No Customer"}
                </h2>
                <div style={{ color: "#4b5563" }}>
                  Date: {job.scheduled_date || "-"} | Status: {job.status}
                </div>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {(job.job_stops || []).map((stop: any) => {
                  const form = forms[stop.id] || {
                    recipient_name: "",
                    pod_notes: "",
                    pod_photo_url: "",
                    pod_document_url: ""
                  };

                  return (
                    <div
                      key={stop.id}
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: 14,
                        padding: 16,
                        background: "#f9fafb"
                      }}
                    >
                      <div style={{ marginBottom: 8 }}>
                        <strong>
                          {stop.stop_order}. {stop.type}
                        </strong>{" "}
                        - {stop.address_line}
                        {stop.city ? `, ${stop.city}` : ""}
                        {stop.postcode ? `, ${stop.postcode}` : ""}
                      </div>

                      <div style={{ color: "#4b5563", marginBottom: 8 }}>
                        Stop status: {stop.status || "-"} | POD: {stop.pod_status || "pending"}
                      </div>

                      {stop.delivered_at ? (
                        <div style={{ color: "#4b5563", marginBottom: 6 }}>
                          Delivered: {new Date(stop.delivered_at).toLocaleString("en-GB")}
                        </div>
                      ) : null}

                      {stop.pod_updated_at ? (
                        <div style={{ color: "#4b5563", marginBottom: 10 }}>
                          POD updated: {new Date(stop.pod_updated_at).toLocaleString("en-GB")}
                        </div>
                      ) : null}

                      {stop.type === "delivery" ? (
                        <div
                          style={{
                            display: "grid",
                            gap: 10,
                            marginTop: 12,
                            maxWidth: 760
                          }}
                        >
                          <input
                            style={inputStyle}
                            placeholder="Recipient name"
                            value={form.recipient_name}
                            onChange={(e: any) =>
                              updateForm(stop.id, "recipient_name", e.target.value)
                            }
                          />

                          <textarea
                            placeholder="POD notes"
                            value={form.pod_notes}
                            onChange={(e: any) =>
                              updateForm(stop.id, "pod_notes", e.target.value)
                            }
                            rows={4}
                            style={{
                              ...inputStyle,
                              resize: "vertical"
                            }}
                          />

                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                              gap: 14
                            }}
                          >
                            <div
                              style={{
                                background: "white",
                                border: "1px solid #e5e7eb",
                                borderRadius: 12,
                                padding: 14
                              }}
                            >
                              <label style={{ display: "block", marginBottom: 8 }}>
                                <strong>Upload photo</strong>
                              </label>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e: any) =>
                                  uploadFile(
                                    e.target.files?.[0],
                                    stop.id,
                                    "pod_photo_url"
                                  )
                                }
                              />
                              {uploadingField === `${stop.id}-pod_photo_url` ? (
                                <div style={{ marginTop: 8, color: "#6b7280" }}>
                                  Uploading photo...
                                </div>
                              ) : null}
                              {form.pod_photo_url ? (
                                <div style={{ marginTop: 10 }}>
                                  <a
                                    href={form.pod_photo_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: "#111827", fontWeight: 600 }}
                                  >
                                    View uploaded photo
                                  </a>
                                </div>
                              ) : null}
                            </div>

                            <div
                              style={{
                                background: "white",
                                border: "1px solid #e5e7eb",
                                borderRadius: 12,
                                padding: 14
                              }}
                            >
                              <label style={{ display: "block", marginBottom: 8 }}>
                                <strong>Upload delivery document</strong>
                              </label>
                              <input
                                type="file"
                                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                                onChange={(e: any) =>
                                  uploadFile(
                                    e.target.files?.[0],
                                    stop.id,
                                    "pod_document_url"
                                  )
                                }
                              />
                              {uploadingField === `${stop.id}-pod_document_url` ? (
                                <div style={{ marginTop: 8, color: "#6b7280" }}>
                                  Uploading document...
                                </div>
                              ) : null}
                              {form.pod_document_url ? (
                                <div style={{ marginTop: 10 }}>
                                  <a
                                    href={form.pod_document_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: "#111827", fontWeight: 600 }}
                                  >
                                    View uploaded document
                                  </a>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              disabled={savingStopId === stop.id}
                              onClick={() => savePod(stop.id, false)}
                            >
                              {savingStopId === stop.id ? "Saving..." : "Save POD Edit"}
                            </button>

                            <button
                              type="button"
                              style={buttonStyle}
                              disabled={savingStopId === stop.id}
                              onClick={() => savePod(stop.id, true)}
                            >
                              {savingStopId === stop.id ? "Saving..." : "Mark Delivered"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}









