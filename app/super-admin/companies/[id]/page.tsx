"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "../../../../lib/supabase/browser";
import { EDITABLE_PROFILE_FIELDS } from "../../../../lib/superAdmin/companyEdit";
import { countBillableVehicles, type VehicleRow, type LicenceRow } from "../../../../lib/billing/vehicleCount";
import { canConfirmMove, requiredMoveConfirmText, type MoveCounts, type MoveCountsError } from "../../../../lib/superAdmin/moveConfirm";
import Field from "../../../../components/Field";
import Textarea from "../../../../components/Textarea";
import Button from "../../../../components/Button";
import MessageBanner from "../../../../components/MessageBanner";
import Skeleton from "../../../../components/Skeleton";
import Modal from "../../../../components/Modal";
import Select from "../../../../components/Select";

type ProfileState = Partial<Record<(typeof EDITABLE_PROFILE_FIELDS)[number], string>>;

type TenantRow = { id: string; name: string | null; company_id: string | null };
type CompanyOption = { id: string; name: string | null };

// PostgREST caps an unscoped select at 1000 rows by default. Mirrors
// POSTGREST_ROW_CAP in lib/billing/server.ts:21, which cannot be imported
// here: that module pulls in the service-role client and the Square SDK,
// neither of which may reach a "use client" bundle. The company picker and
// the tenants-per-company read below are both unbounded in the sense that
// matters here (nothing limits them below the cap), and a truncated read
// would either drop a legitimate move target from the dropdown or hide one
// of this company's own tenants from the list.
const POSTGREST_ROW_CAP = 1000;

/* Grouped for the form only; the allowlist in companyEdit.ts remains the
   authority on what may be written. A field added here but not there is
   silently dropped by the route, which is the safe direction for that
   mistake to fail in; a field added there but not here is invisible to the
   operator, which this list must be kept in step with. */
const CORE_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "trading_name", label: "Trading name" },
  { key: "legal_entity_type", label: "Legal entity type" },
  { key: "industry_type", label: "Industry type" },
  { key: "registration_number", label: "Registration number" },
  { key: "vat_number", label: "VAT number" },
  { key: "tax_number", label: "Tax number" },
  { key: "eori_number", label: "EORI number" },
  { key: "operator_licence_number", label: "Operator licence number" },
];

const CONTACT_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "business_email", label: "Business email" },
  { key: "business_phone", label: "Business phone" },
  { key: "website", label: "Website" },
];

const ADDRESS_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "address_line_1", label: "Address line 1" },
  { key: "address_line_2", label: "Address line 2" },
  { key: "city", label: "City" },
  { key: "region", label: "Region" },
  { key: "postcode", label: "Postcode" },
  { key: "country_code", label: "Country code" },
  { key: "currency_code", label: "Currency code" },
  { key: "timezone", label: "Timezone" },
  { key: "language_code", label: "Language code" },
];

/* This is a UK and EU product. The US fields exist in the schema (some
   companies were seeded with them) and are kept reachable, but collapsed,
   the same way /settings/company treats them. */
const US_FIELDS: Array<{ key: keyof ProfileState; label: string }> = [
  { key: "us_ein", label: "US EIN" },
  { key: "usdot_number", label: "USDOT number" },
  { key: "mc_number", label: "MC number" },
  { key: "ifta_number", label: "IFTA number" },
  { key: "irp_number", label: "IRP number" },
  { key: "scac_code", label: "SCAC code" },
];

export default function SuperAdminCompanyDetailPage() {
  const supabase = useMemo(() => createClient(), []);
  const params = useParams<{ id: string }>();
  const companyId = params.id;

  const [name, setName] = useState("");
  const [profile, setProfile] = useState<ProfileState>({});
  const [loading, setLoading] = useState(true);
  // The id of the company `name`/`profile` actually describe, or null before
  // any load has succeeded. The form is gated on `loadedId === companyId`,
  // not on a bare boolean: a boolean only records THAT a load once
  // succeeded, not WHICH company it was for. Without the id check, navigating
  // from company A's detail page to company B's (same route component,
  // React does not remount it, only companyId changes) would leave `loaded`
  // true from A's fetch while every error branch in load() below returns
  // before touching name/profile - so the form would render, fully
  // populated, with A's data, while Save PATCHes B's id. That this page
  // happens to remount on every navigation today (list-mediated, App
  // Router) is a framework behaviour, not a guarantee this file records
  // anywhere else, so the gate does not get to rely on it.
  //
  // A failed RELOAD for the SAME company (network blip after a save) still
  // leaves loadedId === companyId from the prior success, so the form keeps
  // showing the last known good state instead of being blanked - that
  // property is preserved, only the cross-company case is now impossible.
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Distinguishes "nothing was saved" from "part of the save landed". A
  // partial failure is still an error, but rendering it identically to a
  // clean failure invites the operator to retry the whole form when only one
  // write actually needs retrying.
  const [partial, setPartial] = useState(false);
  const [notice, setNotice] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [allCompanies, setAllCompanies] = useState<CompanyOption[]>([]);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});
  const [tenantsCapWarning, setTenantsCapWarning] = useState("");
  const [tenantBusy, setTenantBusy] = useState(false);

  const [moving, setMoving] = useState<TenantRow | null>(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [moveConfirmText, setMoveConfirmText] = useState("");
  // Keyed to the tenant they describe (see lib/superAdmin/moveConfirm.ts).
  // Never read these without also checking the tenantId matches `moving`:
  // that is what stops a slow response for a cancelled tenant from being
  // rendered - or worse, confirmed against - once a different tenant's
  // dialog is open. canConfirmMove enforces this for the confirm button;
  // the render below enforces it for what the operator SEES.
  const [moveCounts, setMoveCounts] = useState<MoveCounts | null>(null);
  const [moveCountsError, setMoveCountsError] = useState<MoveCountsError | null>(null);
  const [moveCountsWarning, setMoveCountsWarning] = useState<MoveCountsError | null>(null);
  // Rendered INSIDE the modal, not the page-level banner: the page-level
  // MessageBanner sits behind Modal's fixed inset-0 z-50 overlay, so a
  // confirmMove failure reported there while the dialog stays open (on
  // purpose, so the operator can retry) would be invisible - a dialog that
  // visibly did nothing with the reason painted behind an opaque scrim.
  const [moveError, setMoveError] = useState<MoveCountsError | null>(null);

  // Guards against an OVERLAPPING load() call applying its results after a
  // newer one has already started - companyId changing mid-fetch, or
  // Discard clicked while a post-save reload is still in flight. Same
  // purpose as the isMounted() pattern in app/settings/company/page.tsx;
  // implemented as a token rather than a boolean because more than one
  // load() can legitimately be in flight here (save(), rename, confirmMove
  // and the effect can each trigger one), and only the MOST RECENT one's
  // result should ever be applied.
  const loadToken = useRef(0);

  const load = useCallback(
    async (opts?: { keepError?: boolean }) => {
      const token = ++loadToken.current;

      setLoading(true);
      // keepError exists for exactly one caller: save()'s partial-failure
      // branch, which sets error/partial to describe what landed and then
      // calls load() to resync the form with the database. Without this
      // flag, the line below would clear that message before the operator
      // could ever read it - load() always used to win that race, silently.
      if (!opts?.keepError) {
        setError("");
        setPartial(false);
      }

      const [company, profileRow, tenantRows, companyRows] = await Promise.all([
        supabase.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
        // tenant_id holds the COMPANY id here, despite the column name
        // (docs/sql/rls_04_identity_tables.sql:27). One profile row per company.
        supabase.from("company_profiles").select("*").eq("tenant_id", companyId).maybeSingle(),
        supabase.from("tenants").select("id, name, company_id").eq("company_id", companyId).order("name"),
        supabase.from("companies").select("id, name").order("name"),
      ]);

      // A newer load() started while this one was awaiting Supabase. Applying
      // a stale result now would risk overwriting the newer call's error
      // state or, for a companyId change, populating the form with a
      // different company's data. Bail rather than race it.
      if (loadToken.current !== token) return;

      if (company.error) {
        setError(company.error.message);
        setLoading(false);
        return;
      }

      if (!company.data) {
        setError("No such company.");
        setLoading(false);
        return;
      }

      if (profileRow.error) {
        // maybeSingle() returning no row is normal (a company with no profile
        // yet). A real read error is a different fact and must not be treated
        // the same way, which is why this is checked separately from the
        // absence of profileRow.data below.
        setError(profileRow.error.message);
        setLoading(false);
        return;
      }

      if (tenantRows.error) {
        setError(tenantRows.error.message);
        setLoading(false);
        return;
      }

      if (companyRows.error) {
        setError(companyRows.error.message);
        setLoading(false);
        return;
      }

      setName((company.data.name as string | null) ?? "");

      const row = (profileRow.data ?? {}) as Record<string, unknown>;
      const nextProfile: ProfileState = {};
      for (const key of EDITABLE_PROFILE_FIELDS) {
        const value = row[key];
        // null (and a missing profile row) becomes "", so a cleared field
        // shows as an empty box rather than the string "null". The route
        // turns "" back into null on the way in, so round-tripping is
        // lossless. This assumes every allowlisted column is text: a
        // non-text column added to EDITABLE_PROFILE_FIELDS later would
        // silently coerce to "" here, indistinguishable from "was never
        // set", and then get written back as a cleared value on the
        // operator's next save.
        nextProfile[key] = typeof value === "string" ? value : "";
      }
      setProfile(nextProfile);
      // nextProfile.company_name is set above (it IS in
      // EDITABLE_PROFILE_FIELDS) but has no Field of its own anywhere in
      // this form: normalizeCompanyEdit overwrites it unconditionally from
      // `name` on every save (companyEdit.ts's own comment: "so they cannot
      // drift apart"), so whatever loads into it here is carried only to be
      // discarded. Left in rather than filtered out of the loop above, so a
      // stray future Field bound to profile.company_name would show the
      // real loaded value instead of a blank by default.

      const loadedTenants = (tenantRows.data ?? []) as TenantRow[];
      setTenants(loadedTenants);
      setTenantNames(Object.fromEntries(loadedTenants.map((t) => [t.id, t.name ?? ""])));

      const companyOptions = (companyRows.data ?? []) as CompanyOption[];
      setAllCompanies(companyOptions);

      const cappedAt: string[] = [];
      if (loadedTenants.length >= POSTGREST_ROW_CAP) cappedAt.push("this company's tenants");
      if (companyOptions.length >= POSTGREST_ROW_CAP) cappedAt.push("the companies list");
      setTenantsCapWarning(
        cappedAt.length > 0
          ? `${cappedAt.join(" and ")} returned ${POSTGREST_ROW_CAP} or more rows, the PostgREST default cap. Some tenants or target companies may be missing below.`
          : "",
      );

      setLoadedId(companyId);
      setLoading(false);
    },
    [supabase, companyId],
  );

  useEffect(() => {
    // load() is itself recreated whenever companyId changes (it is a
    // dependency of the useCallback above), so this effect re-fires on every
    // navigation between companies without needing companyId listed again
    // here. Not resetting loadedId first: the token guard inside load()
    // already stops a stale in-flight load from applying a previous
    // company's data, and loadedId is compared against companyId everywhere
    // it is read, so a stale loadedId from the outgoing company can never
    // pass the `loadedId === companyId` check for the new one.
    load();
  }, [load]);

  function setProfileField(key: keyof ProfileState, value: string) {
    setProfile((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError("");
    setPartial(false);
    setNotice("");
    setFieldError(null);

    try {
      const response = await fetch(`/api/super-admin/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, profile }),
      });

      const payload = (await response.json()) as { error?: string; field?: string; partial?: boolean };

      if (!response.ok) {
        if (payload.field) setFieldError({ field: payload.field, message: payload.error ?? "" });

        const isPartial = Boolean(payload.partial);
        setError(payload.error ?? "Could not save this company.");
        setPartial(isPartial);

        if (isPartial) {
          // Something real landed. Reload so the form reflects the database
          // rather than the operator's last keystrokes, which no longer
          // match what is actually stored - but keepError so THIS reload
          // does not erase the error/partial message just set above before
          // the operator ever sees it.
          await load({ keepError: true });
        }

        setSaving(false);
        return;
      }

      setNotice("Saved.");
      await load();
    } catch {
      setError("Could not reach the server.");
    }

    setSaving(false);
  }

  async function renameTenant(tenant: TenantRow) {
    setTenantBusy(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`/api/super-admin/tenants/${tenant.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: tenantNames[tenant.id] ?? "" }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setPartial(false);
        setError(payload.error ?? "Could not rename that tenant.");
      } else {
        setNotice("Tenant renamed.");
        await load();
      }
    } catch {
      // fetch() and response.json() both REJECT on a dropped connection or a
      // non-JSON error body, unlike the Supabase reads elsewhere on this
      // page (postgrest-js resolves rather than rejects). Without this catch
      // and the finally below, a rejection here left tenantBusy stuck true
      // forever - every Rename and Move button on the page permanently
      // disabled, with no error shown, until a hard reload.
      setError("Could not reach the server.");
    } finally {
      setTenantBusy(false);
    }
  }

  /* Counts are read before the dialog's confirm button can be used, not
     after confirming, so the operator sees the size of what is about to
     move while they can still back out. Mirrors PATCH
     /api/super-admin/tenants/[id]'s own pre-move counting: vehicles for the
     tenant, then vehicle_licences filtered to those vehicle ids.

     vehicle_licences DOES have a tenant_id, but billing never consults it.
     docs/sql/billing_03_mid_cycle_charges.sql:345 records the rule:
     countBillableVehicles reads vehicles.tenant_id, never the licence's own.
     Routing through vehicles is therefore what keeps this preview and the
     API agreeing on what "billable" means, rather than a missing column.

     Every setMoveCounts/setMoveCountsError/setMoveCountsWarning call below
     is tagged with tenant.id. It is written unconditionally, with no
     generation check - the tag is what makes a late response for a
     different (cancelled) tenant harmless: the render and canConfirmMove
     both require counts.tenantId === moving.id, so a stale tag simply never
     matches once the dialog has moved on. */
  async function openMove(tenant: TenantRow) {
    setMoving(tenant);
    setMoveTarget("");
    setMoveConfirmText("");
    setMoveCounts(null);
    setMoveCountsError(null);
    setMoveCountsWarning(null);
    setMoveError(null);

    const vehiclesResult = await supabase
      .from("vehicles")
      .select("id, tenant_id")
      .eq("tenant_id", tenant.id);

    if (vehiclesResult.error) {
      setMoveCountsError({ tenantId: tenant.id, message: vehiclesResult.error.message });
      return;
    }

    const vehicleRows = (vehiclesResult.data ?? []) as VehicleRow[];
    const vehicleIds = vehicleRows.map((v) => v.id);

    const [licencesResult, usersResult] = await Promise.all([
      vehicleIds.length > 0
        ? supabase.from("vehicle_licences").select("vehicle_id, active").eq("active", true).in("vehicle_id", vehicleIds)
        : Promise.resolve({ data: [] as LicenceRow[], error: null }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    ]);

    if (licencesResult.error) {
      setMoveCountsError({ tenantId: tenant.id, message: licencesResult.error.message });
      return;
    }
    if (usersResult.error) {
      setMoveCountsError({ tenantId: tenant.id, message: usersResult.error.message });
      return;
    }

    const licenceRows = (licencesResult.data ?? []) as LicenceRow[];

    // countBillableVehicles, not a hand-rolled Set: it is the single
    // definition of billable (distinct vehicles with at least one active
    // licence) and is what the API route itself uses to compute
    // moved.billableVehicles, so the dialog cannot drift from the number the
    // operation will actually report back.
    setMoveCounts({
      tenantId: tenant.id,
      vehicles: vehicleRows.length,
      billableVehicles: countBillableVehicles({
        companyId: tenant.id,
        companyTenantIds: [tenant.id],
        vehicles: vehicleRows,
        licences: licenceRows,
      }),
      users: usersResult.count ?? 0,
    });

    // Both reads are guarded, not just vehicles. vehicle_licences is the
    // many-per-vehicle side (this repo's own rule: several active compliance
    // documents per vehicle is normal), so it truncates at the cap FIRST -
    // a tenant with 600 vehicles averaging two licences each returns 1200
    // licence rows and silently under-reports the billable count while a
    // vehicles-only guard stays quiet, because 600 is under 1000.
    const cappedOn: string[] = [];
    if (vehicleRows.length >= POSTGREST_ROW_CAP) cappedOn.push("vehicles");
    if (licenceRows.length >= POSTGREST_ROW_CAP) cappedOn.push("vehicle licences");
    if (cappedOn.length > 0) {
      setMoveCountsWarning({
        tenantId: tenant.id,
        message: `${cappedOn.join(" and ")} hit ${POSTGREST_ROW_CAP} rows, the PostgREST default read cap. The counts above may understate what would actually move.`,
      });
    }
  }

  async function confirmMove() {
    if (!moving) return;

    setTenantBusy(true);
    setMoveError(null);

    try {
      const response = await fetch(`/api/super-admin/tenants/${moving.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: moveTarget }),
      });

      const payload = (await response.json()) as {
        error?: string;
        moved?: { vehicles: number; billableVehicles: number; users: number } | null;
        warning?: string;
      };

      if (!response.ok) {
        // Shown INSIDE the modal (see moveError's declaration above), not the
        // page-level banner: the dialog stays open on purpose so the
        // operator can retry, and the page-level banner is behind the
        // overlay while it is open.
        setMoveError({ tenantId: moving.id, message: payload.error ?? "Could not move that tenant." });
      } else {
        // Both numbers, because they differ and the difference is the money:
        // moved.vehicles is the fleet that moved, moved.billableVehicles is
        // what the destination company is actually charged pro-rata for at
        // the next billing run. payload.warning carries the same row-cap
        // caveat the dialog itself showed, in case the actual move read more
        // rows than the preview did.
        const base = payload.moved
          ? `Tenant moved. ${payload.moved.vehicles} vehicles (${payload.moved.billableVehicles} billable) and ${payload.moved.users} users went with it.`
          : "Tenant updated.";
        setNotice(payload.warning ? `${base} ${payload.warning}` : base);
        setMoving(null);
        await load();
      }
    } catch {
      // Same asymmetry as renameTenant: fetch()/json() reject, the Supabase
      // reads above resolve. Without this, a dropped connection here left
      // tenantBusy stuck true and every Rename/Move button dead.
      setMoveError({ tenantId: moving.id, message: "Could not reach the server." });
    } finally {
      setTenantBusy(false);
    }
  }

  function renderFields(fields: Array<{ key: keyof ProfileState; label: string }>) {
    return fields.map((field) => (
      <Field
        key={String(field.key)}
        id={`profile-${String(field.key)}`}
        label={field.label}
        value={profile[field.key] ?? ""}
        onChange={(event) => setProfileField(field.key, event.target.value)}
        error={fieldError?.field === field.key ? fieldError.message : undefined}
      />
    ));
  }

  const loaded = loadedId === companyId;

  return (
    <div className="ds min-h-screen bg-canvas px-4 py-8 font-sans text-ink md:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-4">
          <Link href="/super-admin/companies" className="text-sm text-ink-3 no-underline hover:text-ink">
            ← All companies
          </Link>

          <h1 className="mb-1 mt-2 text-xl font-semibold tracking-tight text-ink">
            {loading ? <Skeleton w="18ch" h="1.5rem" /> : loaded ? name || "Unnamed company" : "Company"}
          </h1>

          <p className="m-0 font-mono text-xs text-ink-3">{companyId}</p>
        </header>

        {/* Skeletons below are aria-hidden by design, so without this a
            screen reader gets silence for the whole load. */}
        <span className="sr-only" role="status">
          {loading ? "Loading company" : ""}
        </span>

        <MessageBanner tone={partial ? "warning" : "danger"}>{error}</MessageBanner>
        <MessageBanner tone="success">{notice}</MessageBanner>

        {loading ? (
          <div aria-hidden className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                <Skeleton w="20ch" h="1rem" />
              </div>
            ))}
          </div>
        ) : !loaded ? (
          // The load failed outright (bad id, RLS denial, network error), or
          // has not yet completed for THIS companyId. The reason, when there
          // is one, is already stated in the danger banner above; rendering
          // a blank form here as well would read as "this company has no
          // details on record", which is not a fact this page has.
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <p className="m-0 text-sm text-ink-2">This company could not be loaded.</p>
            <div className="mt-3">
              <Button type="button" variant="secondary" onClick={() => load()}>
                Retry
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            className="grid gap-4"
          >
            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Identity</h2>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  id="company-name"
                  label="Company name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  hint="Written to both the company record and the profile, so they cannot drift apart."
                  error={fieldError?.field === "name" ? fieldError.message : undefined}
                  wrapperClassName="sm:col-span-2"
                />

                {renderFields(CORE_FIELDS)}
              </div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Contact</h2>
              <div className="grid gap-3 sm:grid-cols-2">{renderFields(CONTACT_FIELDS)}</div>
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Address and locale</h2>
              <div className="grid gap-3 sm:grid-cols-2">{renderFields(ADDRESS_FIELDS)}</div>
            </section>

            <details className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <summary className="cursor-pointer text-md font-semibold text-ink">
                US registrations
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{renderFields(US_FIELDS)}</div>
            </details>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-3 text-md font-semibold text-ink">Notes</h2>
              <Textarea
                id="profile-notes"
                label="Notes"
                value={profile.notes ?? ""}
                onChange={(event) => setProfileField("notes", event.target.value)}
                rows={4}
              />
            </section>

            <section className="rounded-lg border border-line bg-surface p-4 shadow-sm">
              <h2 className="m-0 mb-1 text-md font-semibold text-ink">Tenants</h2>

              <p className="m-0 mb-3 text-sm text-ink-3">
                Operational data is keyed by tenant. Renaming one is cosmetic; moving one is not.
              </p>

              <MessageBanner tone="warning">{tenantsCapWarning}</MessageBanner>

              {tenants.length === 0 ? (
                <p className="m-0 text-sm text-ink-3">This company has no tenants.</p>
              ) : (
                <div className="grid gap-3">
                  {tenants.map((tenant) => (
                    <div
                      key={tenant.id}
                      className="grid gap-2 rounded-md border border-line bg-surface-2 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
                    >
                      <Field
                        id={`tenant-name-${tenant.id}`}
                        label="Tenant name"
                        value={tenantNames[tenant.id] ?? ""}
                        onChange={(event) =>
                          setTenantNames((current) => ({ ...current, [tenant.id]: event.target.value }))
                        }
                        hint={tenant.id}
                      />

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={tenantBusy || (tenantNames[tenant.id] ?? "") === (tenant.name ?? "")}
                        onClick={() => renameTenant(tenant)}
                      >
                        Rename
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={tenantBusy}
                        onClick={() => openMove(tenant)}
                      >
                        Move
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving" : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => load()} disabled={saving}>
                Discard changes
              </Button>
            </div>
          </form>
        )}
      </div>

      <MoveTenantModal
        moving={moving}
        allCompanies={allCompanies}
        companyId={companyId}
        moveTarget={moveTarget}
        setMoveTarget={setMoveTarget}
        moveConfirmText={moveConfirmText}
        setMoveConfirmText={setMoveConfirmText}
        moveCounts={moveCounts}
        moveCountsError={moveCountsError}
        moveCountsWarning={moveCountsWarning}
        moveError={moveError}
        tenantBusy={tenantBusy}
        onCancel={() => setMoving(null)}
        onConfirm={confirmMove}
      />
    </div>
  );
}

/* Split out only so the parent component above stays readable; it shares the
   parent's state via props rather than owning any of its own. Modal has no
   focus trap (components/Modal.tsx's own comment says so) - for a
   confirmation dialog that moves customer data with no undo, that means Tab
   can walk focus out to the page behind the dialog while it is open. Not
   fixed here: adding a trap is a change to a shared component, and this task
   is scoped to this page; recorded as a should-fix follow-up. */
function MoveTenantModal({
  moving,
  allCompanies,
  companyId,
  moveTarget,
  setMoveTarget,
  moveConfirmText,
  setMoveConfirmText,
  moveCounts,
  moveCountsError,
  moveCountsWarning,
  moveError,
  tenantBusy,
  onCancel,
  onConfirm,
}: {
  moving: TenantRow | null;
  allCompanies: CompanyOption[];
  companyId: string;
  moveTarget: string;
  setMoveTarget: (value: string) => void;
  moveConfirmText: string;
  setMoveConfirmText: (value: string) => void;
  moveCounts: MoveCounts | null;
  moveCountsError: MoveCountsError | null;
  moveCountsWarning: MoveCountsError | null;
  moveError: MoveCountsError | null;
  tenantBusy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const requiredConfirmText = requiredMoveConfirmText(moving);

  // Only ever read counts/errors/warnings that are tagged for the tenant
  // this dialog is currently showing. A response that lands for a tenant
  // the operator has since moved away from (Move A, Cancel, Move B, A's
  // request resolves late) is simply invisible here - see
  // lib/superAdmin/moveConfirm.ts for the full sequence this defends
  // against.
  const countsForThisTenant = moveCounts && moving && moveCounts.tenantId === moving.id ? moveCounts : null;
  const countsErrorForThisTenant =
    moveCountsError && moving && moveCountsError.tenantId === moving.id ? moveCountsError : null;
  const countsWarningForThisTenant =
    moveCountsWarning && moving && moveCountsWarning.tenantId === moving.id ? moveCountsWarning : null;
  const errorForThisTenant = moveError && moving && moveError.tenantId === moving.id ? moveError : null;

  const canConfirm = canConfirmMove({
    tenant: moving,
    counts: countsForThisTenant,
    countsError: countsErrorForThisTenant,
    target: moveTarget,
    typed: moveConfirmText,
    busy: tenantBusy,
  });

  return (
    <Modal
      open={moving !== null}
      onClose={onCancel}
      title="Move this tenant to another company"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="danger" disabled={!canConfirm} onClick={onConfirm}>
            Move tenant
          </Button>
        </>
      }
    >
      <p className="mt-0">
        <strong className="text-ink">{moving?.name || moving?.id}</strong> and everything under it
        will belong to the target company. There is no undo.
      </p>

      {/* role="status": announces to a screen-reader user the moment the
          numbers they are meant to weigh (and that gate the confirm button)
          actually arrive, rather than leaving them to guess when polling a
          silent dialog is done. */}
      <div role="status">
        {countsErrorForThisTenant ? (
          <p className="text-danger-strong">
            Could not count what would move: {countsErrorForThisTenant.message}. Moving is disabled
            until this can be read.
          </p>
        ) : countsForThisTenant ? (
          <>
            <p>
              {countsForThisTenant.vehicles} vehicles and {countsForThisTenant.users} users move with
              it.
            </p>

            {/* The billable subset is the one that costs money. Showing only
                the fleet size would tell the operator 14 vehicles move when
                the charge landing on the destination is for the 9 that carry
                an active licence. */}
            <p className="text-warning-strong">
              {countsForThisTenant.billableVehicles} of those are billable and will be charged to the
              destination company.
            </p>

            {/* Stated because it is money. vehicle_cycle_coverage rows are
                keyed by company, so the arriving vehicles have none at the
                destination and the next billing run charges the new company
                pro-rata for them. This page never writes a coverage row to
                suppress that charge: inventing coverage the new company
                never paid for would be a silent write-off of revenue nobody
                agreed to. */}
            <p className="text-warning-strong">
              Under v1 billing the destination company will be charged pro-rata for these vehicles at
              the next billing run, because their paid-coverage records stay with the old company.
            </p>

            <MessageBanner tone="warning">{countsWarningForThisTenant?.message ?? ""}</MessageBanner>
          </>
        ) : (
          <p>Counting what would move...</p>
        )}
      </div>

      {/* Inside the modal on purpose - see moveError's declaration in the
          parent for why the page-level banner cannot be used here. */}
      <MessageBanner tone="danger">{errorForThisTenant?.message ?? ""}</MessageBanner>

      <Select
        id="move-target"
        label="Target company"
        value={moveTarget}
        onChange={(event) => setMoveTarget(event.target.value)}
      >
        <option value="">Select a company</option>
        {allCompanies
          .filter((company) => company.id !== companyId)
          .map((company) => (
            <option key={company.id} value={company.id}>
              {company.name || company.id}
            </option>
          ))}
      </Select>

      <div className="mt-3">
        <Field
          id="move-confirm"
          label={`Type "${requiredConfirmText}" to confirm`}
          value={moveConfirmText}
          onChange={(event) => setMoveConfirmText(event.target.value)}
        />
      </div>
    </Modal>
  );
}
