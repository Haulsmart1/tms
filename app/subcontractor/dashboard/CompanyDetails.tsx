"use client";

import { useState, type FormEvent } from "react";
import Button from "../../../components/Button";
import Field from "../../../components/Field";
import { subcontractorDetailFields, subcontractorInsuranceFields, subcontractorComplianceFields, type SubcontractorDetails } from "../../../lib/accounts/subcontractorDetails";

export default function CompanyDetails({ details, linkId, preview }: { details: Partial<SubcontractorDetails>; linkId: string; preview: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || preview) return;
    const fields = new FormData(event.currentTarget);
    const values = { ...Object.fromEntries(fields), adr_capable: fields.has("adr_capable") };
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
      setMessage("Company, insurance and compliance details saved.");
    } catch (cause) {
      setError(true);
      setMessage(cause instanceof Error ? cause.message : "Unable to save company details.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      {[
        { label: "Company information", fields: subcontractorDetailFields },
        { label: "Insurance", fields: subcontractorInsuranceFields.flat() },
        { label: "Compliance", fields: subcontractorComplianceFields },
      ].map(({ label, fields }) => (
        <fieldset key={label} disabled={preview} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <legend className="mb-2 font-semibold">{label}</legend>
          {fields.map(([key, fieldLabel, maxLength, type]) => (
            <Field key={key} id={`company-${key}`} name={key} label={fieldLabel} type={type}
              defaultValue={details[key] ?? ""} maxLength={maxLength} />
          ))}
          {label === "Compliance" && (
            <label className="flex items-center gap-2">
              <input name="adr_capable" type="checkbox" defaultChecked={details.adr_capable} />
              ADR capable
            </label>
          )}
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={preview}>Save details</Button>
        {message && <p role={error ? "alert" : "status"} className={error ? "text-danger" : "text-success"}>{message}</p>}
      </div>
    </form>
  );
}
