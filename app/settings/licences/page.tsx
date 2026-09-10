"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../../../lib/supabase/browser";
import { useTenant } from "../../components/TenantProvider";
import TenantGate from "../../components/TenantGate";
import MessageBanner from "../../../components/MessageBanner";
import Button from "../../../components/Button";
import Skeleton from "../../../components/Skeleton";
import Stat from "../../../components/Stat";
import LicenceCard from "./LicenceCard";
import { shouldShowSkeleton } from "../../../lib/loading/skeletonVisibility";
import { computeChargeAmounts, formatPence } from "../../../lib/billing/money";
import type { LicenceVehicle, VehicleLicence } from "./types";

/* Three, because these cards are full width in a single-column grid and are
   taller than a vehicle card. A guess about data that has not arrived. */
const SKELETON_CARDS = 3;

/* One field, and the card is written so that no field is read while loading:
   the cell values it would evaluate eagerly are behind an explicit `loading`
   check in LicenceCard, and everything else is inside a `loading` branch. A
   fuller object would be a second copy of "which fields the card reads",
   drifting silently the first time the card reads one more. THE GUARANTEE
   LIVES IN THE CARD, NOT HERE: see the note above LicenceCard's Vehicle cell
   before adding a field that this object does not have. */
const PLACEHOLDER_LICENCE = { id: "skeleton" } as VehicleLicence;

/* The raw PostgREST shape, deliberately NOT in types.ts. PostgREST returns an
   embedded join as an array even for a to-one relationship, so this exists
   only to be normalised into VehicleLicence by loadData below. types.ts holds
   the normalised UI contract the card consumes; this is a query detail and
   nothing outside this file should ever see it. */
type VehicleLicenceRow = {
    id: string;
    tenant_id: string;
    vehicle_id: string;
    licence_type: string;
    issue_date: string | null;
    expiry_date: string | null;
    active: boolean | null;
    notes: string | null;
    created_at: string;
    vehicles?: LicenceVehicle[] | null;
};

/* A mid-cycle activation can take money, so say so rather than reporting a
   silent success. A customer who is charged without being told will read it
   as a surprise charge when the receipt arrives. */
function licenceAddedMessage(
    payload: {
        charged?: boolean;
        grossPence?: number;
        days?: number;
        alreadyPaid?: boolean;
    },
    base = "Licence added."
): string {
    if (!payload.charged || payload.grossPence == null || payload.days == null) {
        return base;
    }
    /* `charged: true` with `alreadyPaid` is NOT a charge that just happened.
       chargeVehicleAddon found a succeeded row from an earlier attempt, took
       no money this time, and returned that attempt's amounts. Repeating the
       "Charged £x" wording would announce a payment the customer is about to
       look for on their statement and not find twice, which reads as a
       duplicate charge. Name the amount anyway, so they can match it to the
       payment that did happen. */
    if (payload.alreadyPaid) {
        return `${base} An earlier payment of ${formatPence(payload.grossPence)}, covering the ${payload.days} days left in this billing cycle, already paid for this vehicle, so you have not been charged again.`;
    }
    return `${base} Charged ${formatPence(payload.grossPence)} for the ${payload.days} days left in this billing cycle.`;
}

/* The route always answers JSON, but a proxy, an edge timeout or a crash can
   put something else on the wire. Reading the body must never be the thing
   that throws, or a declined card surfaces as an unhandled rejection and the
   customer sees nothing at all. */
async function readJson(response: Response): Promise<Record<string, unknown>> {
    try {
        return (await response.json()) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function errorText(payload: Record<string, unknown>, fallback: string): string {
    return typeof payload.error === "string" && payload.error
        ? payload.error
        : fallback;
}

/* One string, said in every place the restriction bites: the notice where the
   form used to be, and the answer to a staff member who clicks Activate. Two
   wordings would drift, and this one has to name the reason (money) and the
   way out (an admin), not just the refusal. */
const RESTRICTED_NOTICE =
    "Adding or activating a licence charges your company card, so it is limited to company admins. Ask a company admin to make the change for you.";

/* Deleting is gated for a different reason, so it gets its own wording rather
   than borrowing the one above: a delete never charges the card, and telling a
   staff member that it does would be its own small lie. It is gated because
   deleting an active licence removes a billable vehicle, which is the
   deactivation half of the change the route already reserves for admins.
   Deletion stays a direct table write (the migration keeps the browser's
   DELETE grant on purpose, since removing a licence can only ever reduce a
   bill); this is the affordance catching up with that decision. */
const RESTRICTED_DELETE_NOTICE =
    "Deleting a licence changes what your company is billed for, so it is limited to company admins. Ask a company admin to make the change for you.";

export default function VehicleLicencesPage() {
    const supabase = createClient();
    const tenant = useTenant();

    const [vehicles, setVehicles] = useState<LicenceVehicle[]>([]);
    const [licences, setLicences] = useState<VehicleLicence[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");

    /* A ref, not the `saving` state, because state is what makes the double
       charge possible: two clicks in the same tick both read the pre-render
       value and both post. Activating a vehicle mid-cycle takes real money, so
       the second post must be refused synchronously. `saving` stays as the
       thing the submit button reads. */
    const writeInFlight = useRef(false);
    const [dataTenantId, setDataTenantId] = useState<string | null | undefined>(undefined);

    /* Mirrors the route's gate rather than inventing a second rule: the route
       authorises through requireCompanyAdmin, which allows ACCOUNTS_ADMIN_ROLES
       (lib/accounts/authz.ts), and that is exactly ["admin", "super_admin"].
       Reading tenant.role only once status is "ready" is the pattern
       app/settings/billing/page.tsx uses, and for its stated reason: before
       that, role is the provider's placeholder "staff", so gating early would
       flash this notice at every admin. Not-ready therefore counts as allowed.
       That optimism is safe because it only decides what is on screen; the
       route is the boundary and refuses anyone it lets through. */
    const canManageLicences =
        tenant.status !== "ready" ||
        tenant.role === "admin" ||
        tenant.role === "super_admin";

    const [vehicleId, setVehicleId] = useState("");
    const [licenceType, setLicenceType] = useState("");
    const [issueDate, setIssueDate] = useState("");
    const [expiryDate, setExpiryDate] = useState("");
    const [active, setActive] = useState(true);
    const [notes, setNotes] = useState("");

    async function loadData() {
        if (tenant.status !== "ready") return;

        setLoading(true);
        setMessage("");

        const [
            { data: vehicleData, error: vehicleError },
            { data: licenceData, error: licenceError },
        ] = await Promise.all([
            tenant
                .filterByTenant(
                    supabase
                        .from("vehicles")
                        .select("id, tenant_id, registration, vehicle_type, make, model, active")
                )
                .order("registration", { ascending: true }),
            tenant
                .filterByTenant(
                    supabase
                        .from("vehicle_licences")
                        /* superseded_by filters out rows a later activation
                           replaced. v2 reactivation inserts a new row rather
                           than clearing deactivated_at, because clearing it
                           destroys the history the invoice is computed from;
                           without this filter the replaced row sits here
                           looking like a duplicate and can be toggled again,
                           minting another. */
                        .select(`
          id,
          tenant_id,
          vehicle_id,
          licence_type,
          issue_date,
          expiry_date,
          active,
          notes,
          created_at,
          vehicles (
            id,
            tenant_id,
            registration,
            vehicle_type,
            make,
            model,
            active
          )
        `)
                )
                .is("superseded_by", null)
                .order("created_at", { ascending: false }),
        ]);

        if (vehicleError) {
            setMessage(vehicleError.message);
        }

        if (licenceError) {
            setMessage(licenceError.message);
        }

        const normalizedLicences: VehicleLicence[] = (licenceData ?? []).map(
            (licence: VehicleLicenceRow) => ({
                ...licence,
                vehicles: licence.vehicles?.[0] ?? null,
            })
        );

        setVehicles(vehicleData ?? []);
        setLicences(normalizedLicences);
        if (!licenceError) {
            setDataTenantId(tenant.activeTenantId);
        }
        setLoading(false);
    }

    useEffect(() => {
        loadData();
    }, [tenant.status, tenant.activeTenantId]);

    function resetForm() {
        setVehicleId("");
        setLicenceType("");
        setIssueDate("");
        setExpiryDate("");
        setActive(true);
        setNotes("");
    }

    async function createLicence(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setMessage("");

        /* The form is not rendered for a non-admin, so this only fires if one
           reaches the handler another way. Cheaper than letting them fill in a
           form and read a raw 403 back from the route. */
        if (!canManageLicences) {
            setMessage(RESTRICTED_NOTICE);
            return;
        }

        if (!vehicleId) {
            setMessage("Please select a vehicle.");
            return;
        }

        if (!licenceType.trim()) {
            setMessage("Please enter a licence type.");
            return;
        }

        if (!tenant.writeTenantId) {
            setMessage("Pick a specific tenant to create records.");
            return;
        }

        if (writeInFlight.current) return;
        writeInFlight.current = true;
        setSaving(true);

        /* Through the route, never straight at the table: an active licence is
           what makes a vehicle billable, so creating one may have to take a
           pro-rata payment first. billing_03 revokes the browser's INSERT and
           UPDATE grant on vehicle_licences for exactly that reason, so this is
           the only path that can still write one. */
        let successText = "Licence added.";
        try {
            const response = await fetch("/api/licences/activate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "create",
                    tenantId: tenant.writeTenantId,
                    vehicleId,
                    licenceType: licenceType.trim(),
                    issueDate: issueDate || null,
                    expiryDate: expiryDate || null,
                    active,
                    notes: notes.trim() || null,
                }),
            });
            const payload = await readJson(response);

            if (!response.ok) {
                /* The route's own wording, verbatim. Its 402 and 409 texts name
                   the card, the billing page or the wait-and-retry the customer
                   actually has to do; a generic "could not add licence" would
                   throw that away. */
                setMessage(
                    errorText(payload, "Could not add the licence. Please try again.")
                );
                return;
            }

            resetForm();
            successText = licenceAddedMessage(payload);
        } catch {
            /* A network failure leaves the outcome unknown: the request may
               have reached the route and charged. Do not claim it did nothing. */
            setMessage(
                "Could not reach the server, so it is not clear whether the licence was added. Reload the page to check before trying again."
            );
            return;
        } finally {
            writeInFlight.current = false;
            setSaving(false);
        }

        await loadData();

        /* AFTER the refresh, because loadData clears `message` on entry. Said
           before it, a "charged £x" notice would be wiped in the same render
           and the customer would never see that money had been taken. */
        setMessage(successText);
    }

    async function deleteLicence(id: string) {
        /* Same early return as toggleLicence, and for the same reason: the
           disabled button is an affordance that devtools removes in one click,
           so the refusal has to live in the handler too. */
        if (!canManageLicences) {
            setMessage(RESTRICTED_DELETE_NOTICE);
            return;
        }

        if (!window.confirm("Delete licence?")) return;

        /* Shares writeInFlight with the two charging paths rather than keeping
           its own flag. A delete landing between an activation's POST and its
           reload would leave the page reporting a charge for a row that is
           gone, and one guard for every write on the page is the only version
           of this rule that cannot drift. */
        if (writeInFlight.current) return;
        writeInFlight.current = true;
        setSaving(true);

        /* Through the route now, like create and toggle. billing_03 used to
           keep the browser's DELETE grant on the reasoning that removing a
           licence can only reduce a bill; under arrears billing the invoice is
           computed at period close FROM these rows, so deleting one that was
           ever live destroys the evidence and a vehicle silently disappears
           from an invoice it belonged on. billing_07 STEP 2 revokes the grant,
           and the route allows a delete only for a licence that was never
           activated, which is the case that actually happens: a typo. */
        try {
            const response = await fetch("/api/licences/activate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "delete", licenceId: id }),
            });
            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
                writeInFlight.current = false;
                setSaving(false);
                setMessage(
                    typeof payload?.error === "string"
                        ? payload.error
                        : "The licence could not be deleted."
                );
                return;
            }
        } catch {
            writeInFlight.current = false;
            setSaving(false);
            setMessage("The licence could not be deleted. Check your connection and try again.");
            return;
        }

        writeInFlight.current = false;
        setSaving(false);

        await loadData();

        /* After the refresh, for the same reason as createLicence: loadData
           clears `message` on entry. */
        setMessage("Licence deleted.");
    }

    async function toggleLicence(id: string, currentActive: boolean | null) {
        /* Answers the click with the reason instead of the route's raw 403,
           which says "You do not have access to this tenant." and is both
           confusing and wrong about why. Deactivation is refused here too: the
           route gates the whole endpoint, not just the charging direction, so
           letting the button through would only move the 403 later. */
        if (!canManageLicences) {
            setMessage(RESTRICTED_NOTICE);
            return;
        }

        /* Unguarded before this: the card's Activate button is only disabled
           while the skeleton shows, so two quick clicks used to send two
           updates. Harmless against a plain UPDATE, but each one can now take a
           pro-rata payment, so the second click must be dropped. */
        if (writeInFlight.current) return;
        writeInFlight.current = true;
        setSaving(true);
        setMessage("");

        const nextActive = !currentActive;
        let successText = nextActive
            ? "Licence activated."
            : "Licence deactivated.";

        /* Both directions go through the route, not just activation: billing_03
           revokes the browser's UPDATE grant on vehicle_licences outright,
           because `active` is what makes a vehicle billable and the server has
           to be the only thing that can set it either way. */
        try {
            const response = await fetch("/api/licences/activate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "setActive",
                    licenceId: id,
                    active: nextActive,
                }),
            });
            const payload = await readJson(response);

            if (!response.ok) {
                setMessage(
                    errorText(
                        payload,
                        nextActive
                            ? "Could not activate the licence. Please try again."
                            : "Could not deactivate the licence. Please try again."
                    )
                );
                return;
            }

            /* Only an activation can have taken money. A deactivation is never
               charged and never refunded, so it says nothing about money. */
            if (nextActive) {
                successText = licenceAddedMessage(payload, "Licence activated.");
            }
        } catch {
            setMessage(
                nextActive
                    ? "Could not reach the server, so it is not clear whether the licence was activated. Reload the page to check before trying again."
                    : "Could not reach the server, so the licence may not have been deactivated. Reload the page to check."
            );
            return;
        } finally {
            writeInFlight.current = false;
            setSaving(false);
        }

        await loadData();

        /* After the refresh, for the same reason as createLicence: loadData
           clears `message`. */
        setMessage(successText);
    }

    function vehicleLabel(vehicle: LicenceVehicle) {
        const parts = [
            vehicle.registration || "No registration",
            vehicle.vehicle_type || null,
            [vehicle.make, vehicle.model].filter(Boolean).join(" ") || null,
            vehicle.active === false ? "Inactive" : "Active",
        ].filter(Boolean);

        return parts.join(" • ");
    }

    const billableVehicleCount = useMemo(() => {
        const uniqueVehicleIds = new Set(
            licences
                .filter((licence) => licence.active)
                .map((licence) => licence.vehicle_id)
        );

        return uniqueVehicleIds.size;
    }, [licences]);

    const amounts = computeChargeAmounts(billableVehicleCount);

    /* ONE flag, because the two containers it drives - the Stat row and the
       card grid - both read `licences` and nothing else, which makes them one
       region separated by the add form. The vehicles list loaded alongside
       feeds only that form's <select>, whose options are not visible until it
       is opened, so it needs no flag of its own.

       Each container carries its own aria-busy; exactly ONE sr-only
       role="status" line travels with the flag, and it sits on the grid, which
       is the region the old "Loading..." card stood in for. Both rules are
       stated in full above shouldShowSkeleton in
       lib/loading/skeletonVisibility.ts. */
    const showSkeleton = shouldShowSkeleton({
        tenantStatus: tenant.status,
        fetching: loading,
        hasData: licences.length > 0,
        activeTenantId: tenant.activeTenantId,
        dataTenantId,
    });

    const showEmpty = !showSkeleton && licences.length === 0;

    return (
        <TenantGate>
        <div className="ds min-h-screen bg-canvas font-sans text-ink">
        <main className="mx-auto max-w-[1480px] px-6 py-8">
            <header className="mb-4">
                <div className="text-kicker uppercase text-ink-3">Admin</div>
                <h1 className="mb-1 mt-0.5 text-xl font-semibold tracking-tight text-ink">Vehicle Licences</h1>
                <p className="m-0 text-sm text-ink-3">
                    Add and manage vehicle licences. £10 per licensed vehicle
                    per week, less per vehicle on larger fleets, charged every 4
                    weeks.
                </p>
            </header>

            {/* These two tiles are derived from `licences`, so they are part of
                the same loading region as the grid below and must not state a
                count of zero as fact while the query is in flight. The third
                is the fixed price and is never a skeleton. */}
            <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-busy={showSkeleton}>
                <Stat
                    label="Licensed Vehicles"
                    value={
                        showSkeleton ? (
                            <Skeleton display="inline-block" w="2.5ch" h="1.25rem" />
                        ) : (
                            String(billableVehicleCount)
                        )
                    }
                />
                <Stat
                    label="4-Weekly Charge"
                    value={
                        showSkeleton ? (
                            <Skeleton display="inline-block" w="10ch" h="1.25rem" />
                        ) : (
                            formatPence(amounts.grossPence)
                        )
                    }
                    sub="this tenant only, inc VAT"
                />
                <Stat label="Billing Rule" value="£10" sub="per vehicle per week, less on larger fleets" />
            </div>

            {/* The notice replaces the form rather than disabling it: a filled
                in form that cannot be submitted is a longer way of saying the
                same thing. The list below stays untouched, because a staff
                member losing sight of their own licences would be a worse
                regression than losing the ability to change them.
                MessageBanner tone="info" is what settings/billing uses for its
                "managed by your company admin" notice, so this is that page's
                treatment and not a new one. */}
            {canManageLicences ? (
            <form
                onSubmit={createLicence}
                className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3"
            >
                <select
                    value={vehicleId}
                    onChange={(event) => setVehicleId(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
                    required
                >
                    <option value="">Select vehicle</option>
                    {vehicles.map((vehicle) => (
                        <option key={vehicle.id} value={vehicle.id}>
                            {vehicleLabel(vehicle)}
                        </option>
                    ))}
                </select>

                <input
                    type="text"
                    placeholder="Licence type"
                    value={licenceType}
                    onChange={(event) => setLicenceType(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                    required
                />

                <input
                    type="date"
                    value={issueDate}
                    onChange={(event) => setIssueDate(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                />

                <input
                    type="date"
                    value={expiryDate}
                    onChange={(event) => setExpiryDate(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                />

                <input
                    type="text"
                    placeholder="Notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink placeholder:text-ink-3"
                />

                <label className="flex min-h-10 items-center gap-2 rounded-md border border-ink-3 bg-surface px-3 text-sm text-ink-2">
                    <input
                        type="checkbox"
                        checked={active}
                        onChange={(event) => setActive(event.target.checked)}
                    />
                    Active for billing
                </label>

                <div className="sm:col-span-2 lg:col-span-3">
                    <Button type="submit" disabled={saving}>
                        {saving ? "Saving..." : "Add Licence"}
                    </Button>
                </div>
            </form>
            ) : (
                <MessageBanner tone="info">{RESTRICTED_NOTICE}</MessageBanner>
            )}

            <MessageBanner tone="neutral">{message}</MessageBanner>

            {showEmpty ? (
                <p className="py-10 text-center text-sm text-ink-3">
                    No licences found.
                </p>
            ) : null}

            {/* ONE grid container shared by the skeleton and the real cards, and
                not rendered at all when there is neither, matching /vehicles and
                /subcontractors. Two containers would let these classes drift
                apart and the layout jump on arrival. */}
            {showSkeleton || licences.length > 0 ? (
                <div className="grid gap-3" aria-busy={showSkeleton}>
                    {/* One announcement for the region, not one per bar. Replaces
                        what the old "Loading..." card gave free. */}
                    {showSkeleton ? (
                        <span className="sr-only" role="status">Loading licences</span>
                    ) : null}

                    {showSkeleton
                        ? Array.from({ length: SKELETON_CARDS }, (_, index) => (
                            <LicenceCard
                                key={`skeleton-${index}`}
                                licence={PLACEHOLDER_LICENCE}
                                loading
                                onToggle={() => {}}
                                onDelete={() => {}}
                            />
                        ))
                        : licences.map((licence) => (
                            <LicenceCard
                                key={licence.id}
                                licence={licence}
                                /* Affordance only, for both buttons.
                                   toggleLicence and deleteLicence each keep
                                   their own early return, and the route keeps
                                   requireCompanyAdmin: a disabled attribute is
                                   removed in devtools in one click. */
                                canManage={canManageLicences}
                                onToggle={(id, active) => void toggleLicence(id, active)}
                                onDelete={(id) => void deleteLicence(id)}
                            />
                        ))}
                </div>
            ) : null}
        </main>
        </div>
        </TenantGate>
    );
}
