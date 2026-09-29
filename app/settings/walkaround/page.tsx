"use client";

/*
  /settings/walkaround: the company's walkaround checklist. Reads and writes go
  through app/api/settings/walkaround (not the browser client directly), which
  authorizes the caller and derives the company from the tenant. The locked
  baseline (company_id null) is shown but never editable here; the server-side
  WLK03 trigger backs that up.
*/

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Badge from "../../../components/Badge";
import Button from "../../../components/Button";
import Field from "../../../components/Field";
import MessageBanner from "../../../components/MessageBanner";
import Select from "../../../components/Select";
import { groupByItem } from "../../../lib/walkaround/catalogue";
import type { AppliesTo, CatalogueItem, Severity } from "../../../lib/walkaround/types";
import TenantGate from "../../components/TenantGate";
import { useTenant } from "../../components/TenantProvider";

const SEVERITY_LABEL: Record<Severity, string> = { minor: "Minor", dangerous: "Dangerous" };
const APPLIES_TO_LABEL: Record<AppliesTo, string> = { vehicle: "Vehicle", trailer: "Trailer", both: "Vehicle and trailer" };

const EMPTY_ITEM_FORM = {
  category: "",
  itemLabel: "",
  defectLabel: "",
  guidance: "",
  severity: "minor" as Severity,
  appliesTo: "vehicle" as AppliesTo,
};

function severityBadge(severity: Severity) {
  return <Badge tone={severity === "dangerous" ? "danger" : "warning"}>{SEVERITY_LABEL[severity]}</Badge>;
}

function sortedByItem(items: readonly CatalogueItem[]): CatalogueItem[] {
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
}

export default function WalkaroundSettingsPage() {
  return (
    <TenantGate>
      <WalkaroundSettingsView />
    </TenantGate>
  );
}

function WalkaroundSettingsView() {
  const tenant = useTenant();

  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [baseline, setBaseline] = useState<CatalogueItem[]>([]);
  const [companyItems, setCompanyItems] = useState<CatalogueItem[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [onCallPhone, setOnCallPhone] = useState("");
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");

  const [itemForm, setItemForm] = useState(EMPTY_ITEM_FORM);
  const [addingItem, setAddingItem] = useState(false);
  const [addError, setAddError] = useState("");

  const [guidanceDrafts, setGuidanceDrafts] = useState<Record<string, string>>({});
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const needsTenant = tenant.status === "ready" && !tenant.activeTenantId;

  const headers = useMemo(() => {
    const result: Record<string, string> = { "Content-Type": "application/json" };
    if (tenant.activeTenantId) result["x-tenant-id"] = tenant.activeTenantId;
    return result;
  }, [tenant.activeTenantId]);

  const load = useCallback(async () => {
    if (!tenant.activeTenantId) return;
    setState("loading");
    setLoadError("");
    try {
      const response = await fetch("/api/settings/walkaround", { headers, cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not load the walkaround checklist.");
      const nextCompanyItems = (body.companyItems ?? []) as CatalogueItem[];
      setBaseline((body.baseline ?? []) as CatalogueItem[]);
      setCompanyItems(nextCompanyItems);
      setGuidanceDrafts(Object.fromEntries(nextCompanyItems.map((i) => [i.id, i.guidance])));
      setCanEdit(Boolean(body.canEdit));
      setOnCallPhone(typeof body.onCallPhone === "string" ? body.onCallPhone : "");
      setState("ready");
    } catch (error) {
      console.error("[settings/walkaround] load failed", error);
      setLoadError(error instanceof Error ? error.message : "Could not load the walkaround checklist.");
      setState("error");
    }
  }, [headers, tenant.activeTenantId]);

  useEffect(() => {
    if (tenant.status !== "ready" || !tenant.activeTenantId) return;
    void load();
    // headers is derived from tenant.activeTenantId, so it is not a separate dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant.status, tenant.activeTenantId]);

  async function savePhone(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setSavingPhone(true);
    setPhoneError("");
    setNotice("");
    try {
      const response = await fetch("/api/settings/walkaround", {
        method: "PUT",
        headers,
        body: JSON.stringify({ onCallPhone }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not save the on-call number.");
      setOnCallPhone(typeof body.onCallPhone === "string" ? body.onCallPhone : "");
      setNotice("On-call number saved.");
    } catch (error) {
      setPhoneError(error instanceof Error ? error.message : "Could not save the on-call number.");
    } finally {
      setSavingPhone(false);
    }
  }

  async function addItem(event: FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setAddingItem(true);
    setAddError("");
    try {
      const response = await fetch("/api/settings/walkaround/items", {
        method: "POST",
        headers,
        body: JSON.stringify(itemForm),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not add the item.");
      const item = body.item as CatalogueItem;
      setCompanyItems((current) => [...current, item]);
      setGuidanceDrafts((current) => ({ ...current, [item.id]: item.guidance }));
      setItemForm(EMPTY_ITEM_FORM);
      setNotice(`Added "${item.defectLabel}".`);
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Could not add the item.");
    } finally {
      setAddingItem(false);
    }
  }

  async function patchItem(id: string, patch: { severity?: Severity; guidance?: string; retired?: boolean }) {
    if (!canEdit) return;
    setRowBusyId(id);
    setRowError(null);
    try {
      const response = await fetch(`/api/settings/walkaround/items/${id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || "Could not save the change.");
      const updated = body.item as CatalogueItem;
      setCompanyItems((current) => current.map((i) => (i.id === id ? updated : i)));
      setGuidanceDrafts((current) => ({ ...current, [id]: updated.guidance }));
    } catch (error) {
      setRowError({ id, message: error instanceof Error ? error.message : "Could not save the change." });
    } finally {
      setRowBusyId(null);
    }
  }

  const baselineGroups = useMemo(() => groupByItem(sortedByItem(baseline)), [baseline]);
  const companyRows = useMemo(() => sortedByItem(companyItems), [companyItems]);

  return (
    <div className="ds min-h-screen bg-canvas font-sans text-ink">
      <main className="mx-auto max-w-4xl px-6 py-8">
        <header className="mb-4">
          <div className="text-kicker uppercase text-ink-2">Admin</div>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-ink">Walkaround checklist</h1>
          <p className="mt-1 text-sm text-ink-2">
            The checks drivers must pass before working, and who they call when one takes a vehicle off the road.
          </p>
        </header>

        <MessageBanner tone="success">{notice || null}</MessageBanner>
        <MessageBanner tone="danger">{state === "error" ? loadError : null}</MessageBanner>

        {needsTenant ? (
          <p className="py-10 text-center text-sm text-ink-3">
            Choose a tenant in the selector to see and edit its walkaround checklist.
          </p>
        ) : state === "loading" ? (
          <p className="py-10 text-center text-sm text-ink-3">Loading the checklist...</p>
        ) : state === "error" ? null : (
          <div className="flex flex-col gap-6">
            {!canEdit ? (
              <MessageBanner tone="info">Only an admin can change the checklist.</MessageBanner>
            ) : null}

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-ink">On-call number</h2>
              <p className="mb-3 text-xs text-ink-2">
                Drivers see a Call transport manager button with this number when a check takes a vehicle off the road.
              </p>
              <form onSubmit={savePhone} className="flex flex-wrap items-end gap-3">
                <Field
                  id="on-call-phone"
                  label="Phone number"
                  type="tel"
                  value={onCallPhone}
                  onChange={(event) => setOnCallPhone(event.target.value)}
                  disabled={!canEdit}
                  error={phoneError || undefined}
                  wrapperClassName="w-64"
                  placeholder="e.g. 01234 567890"
                />
                {canEdit ? (
                  <Button type="submit" loading={savingPhone} disabled={savingPhone}>
                    Save
                  </Button>
                ) : null}
              </form>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-ink">Baseline checklist (locked)</h2>
              <p className="mb-3 text-xs text-ink-2">
                Based on the DVSA daily walkaround check. These items and their severities cannot be changed or removed.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs text-ink-3">
                      <th className="py-2 pr-3 font-medium">Item</th>
                      <th className="py-2 pr-3 font-medium">Defect</th>
                      <th className="py-2 pr-3 font-medium">Severity</th>
                      <th className="py-2 pr-3 font-medium">Applies to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baselineGroups.map((group) =>
                      group.defects.map((defect, index) => (
                        <tr key={defect.id} className="border-b border-line last:border-0">
                          <td className="py-2 pr-3 align-top text-ink-2">
                            {index === 0 ? group.itemLabel : null}
                          </td>
                          <td className="py-2 pr-3 align-top text-ink">{defect.defectLabel}</td>
                          <td className="py-2 pr-3 align-top">{severityBadge(defect.severity)}</td>
                          <td className="py-2 pr-3 align-top text-ink-2">{APPLIES_TO_LABEL[defect.appliesTo]}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="mb-3 text-sm font-semibold text-ink">Your company's items</h2>

              {companyRows.length === 0 ? (
                <p className="mb-3 text-sm text-ink-3">No company items yet.</p>
              ) : (
                <div className="mb-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line text-xs text-ink-3">
                        <th className="py-2 pr-3 font-medium">Item</th>
                        <th className="py-2 pr-3 font-medium">Defect</th>
                        <th className="py-2 pr-3 font-medium">Guidance</th>
                        <th className="py-2 pr-3 font-medium">Severity</th>
                        <th className="py-2 pr-3 font-medium">Applies to</th>
                        {canEdit ? <th className="py-2 pr-3 font-medium">Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {companyRows.map((item) => {
                        const retired = item.retiredAt !== null;
                        const busy = rowBusyId === item.id;
                        return (
                          <tr
                            key={item.id}
                            className={`border-b border-line last:border-0 align-top ${retired ? "opacity-60" : ""}`}
                          >
                            <td className="py-2 pr-3 text-ink">
                              {item.itemLabel}
                              {retired ? <span className="ml-2 text-xs text-ink-3">(retired)</span> : null}
                            </td>
                            <td className="py-2 pr-3 text-ink">{item.defectLabel}</td>
                            <td className="py-2 pr-3">
                              {canEdit ? (
                                <div className="flex items-start gap-2">
                                  <textarea
                                    className="h-16 w-48 min-w-0 rounded-md border border-ink-3 bg-surface px-2 py-1 text-sm text-ink"
                                    value={guidanceDrafts[item.id] ?? item.guidance}
                                    disabled={busy || retired}
                                    onChange={(event) =>
                                      setGuidanceDrafts((current) => ({ ...current, [item.id]: event.target.value }))
                                    }
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={busy || retired || (guidanceDrafts[item.id] ?? item.guidance) === item.guidance}
                                    onClick={() => patchItem(item.id, { guidance: guidanceDrafts[item.id] ?? item.guidance })}
                                  >
                                    Save
                                  </Button>
                                </div>
                              ) : (
                                item.guidance
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              {canEdit ? (
                                <select
                                  aria-label={`Severity for ${item.defectLabel}`}
                                  className="h-9 w-32 rounded-md border border-ink-3 bg-surface px-2 text-sm text-ink"
                                  value={item.severity}
                                  disabled={busy || retired}
                                  onChange={(event) => patchItem(item.id, { severity: event.target.value as Severity })}
                                >
                                  <option value="minor">Minor</option>
                                  <option value="dangerous">Dangerous</option>
                                </select>
                              ) : (
                                severityBadge(item.severity)
                              )}
                            </td>
                            <td className="py-2 pr-3 text-ink-2">{APPLIES_TO_LABEL[item.appliesTo]}</td>
                            {canEdit ? (
                              <td className="py-2 pr-3">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={retired ? "secondary" : "danger"}
                                  disabled={busy}
                                  onClick={() => patchItem(item.id, { retired: !retired })}
                                >
                                  {retired ? "Restore" : "Retire"}
                                </Button>
                                {rowError && rowError.id === item.id ? (
                                  <p className="mt-1 text-xs text-danger-strong">{rowError.message}</p>
                                ) : null}
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {canEdit ? (
                <form onSubmit={addItem} className="grid gap-3 rounded-md border border-line bg-surface-2 p-3 sm:grid-cols-2">
                  <Field
                    id="item-category"
                    label="Category"
                    value={itemForm.category}
                    onChange={(event) => setItemForm((f) => ({ ...f, category: event.target.value }))}
                    placeholder="e.g. Load security"
                    required
                  />
                  <Field
                    id="item-label"
                    label="Item name"
                    value={itemForm.itemLabel}
                    onChange={(event) => setItemForm((f) => ({ ...f, itemLabel: event.target.value }))}
                    placeholder="e.g. Curtains and straps"
                    required
                  />
                  <Field
                    id="item-defect"
                    label="Defect"
                    value={itemForm.defectLabel}
                    onChange={(event) => setItemForm((f) => ({ ...f, defectLabel: event.target.value }))}
                    placeholder="e.g. Curtain torn or strap missing"
                    required
                    wrapperClassName="sm:col-span-2"
                  />
                  <Field
                    id="item-guidance"
                    label="Guidance"
                    value={itemForm.guidance}
                    onChange={(event) => setItemForm((f) => ({ ...f, guidance: event.target.value }))}
                    placeholder="What the driver should check"
                    wrapperClassName="sm:col-span-2"
                  />
                  <Select
                    id="item-severity"
                    label="Severity"
                    value={itemForm.severity}
                    onChange={(event) => setItemForm((f) => ({ ...f, severity: event.target.value as Severity }))}
                  >
                    <option value="minor">Minor</option>
                    <option value="dangerous">Dangerous</option>
                  </Select>
                  <Select
                    id="item-applies-to"
                    label="Applies to"
                    value={itemForm.appliesTo}
                    onChange={(event) => setItemForm((f) => ({ ...f, appliesTo: event.target.value as AppliesTo }))}
                  >
                    <option value="vehicle">Vehicle</option>
                    <option value="trailer">Trailer</option>
                    <option value="both">Vehicle and trailer</option>
                  </Select>
                  {addError ? <p className="text-xs text-danger-strong sm:col-span-2">{addError}</p> : null}
                  <div className="sm:col-span-2">
                    <Button type="submit" loading={addingItem} disabled={addingItem}>
                      Add item
                    </Button>
                  </div>
                </form>
              ) : null}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
