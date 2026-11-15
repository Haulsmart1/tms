"use client";

import { useState, type FormEvent } from "react";
import Button from "../../../components/Button";
import Field from "../../../components/Field";
import { subcontractorDetailFields, type SubcontractorDetails } from "../../../lib/accounts/subcontractorDetails";

export default function CompanyDetails({ details, linkId }: { details: Partial<SubcontractorDetails>; linkId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const response = await fetch(`/api/subcontractor/me?link=${encodeURIComponent(linkId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save company details.");
      setMessage("Company details saved.");
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Unable to save company details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {subcontractorDetailFields.map(([key, label, maxLength, type]) => (
          <Field key={key} id={`company-${key}`} name={key} label={label} type={type}
            defaultValue={details[key] ?? ""} maxLength={maxLength} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy}>Save company details</Button>
        {message && <p role={error ? "alert" : "status"} className={error ? "text-danger" : "text-success"}>{message}</p>}
      </div>
    </form>
  );
}
