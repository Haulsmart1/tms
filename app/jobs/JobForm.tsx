import Field from "../../components/Field";
import Button from "../../components/Button";

type Stop = { type: "collection" | "delivery"; address_line: string; city: string; postcode: string };

type FormState = {
  reference: string;
  scheduled_date: string;
  customer_id: string;
  vehicle_id: string;
  driver_id: string;
  customer_price: string;
  subcontractor_id: string;
  subcontractor_cost: string;
  journey_scope: string;
  origin_country_code: string;
  destination_country_code: string;
  compliance_regime_override: string;
  compliance_override_reason: string;
  stops: Stop[];
};

type Option = { id: string; label: string };

type Props = {
  form: FormState;
  editingJobId: string | null;
  loading: boolean;
  customers: Option[];
  vehicles: Option[];
  drivers: Option[];
  subcontractors: Option[];
  onFieldChange: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
  onStopChange: (index: number, field: keyof Stop, value: string) => void;
  onAddStop: (type: Stop["type"]) => void;
  onRemoveStop: (index: number) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancelEdit: () => void;
};

function StopRow({
  stop, index, onChange, onRemove,
}: { stop: Stop; index: number; onChange: (field: keyof Stop, value: string) => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field
        id={`stop-${stop.type}-${index}-address`}
        label="Address"
        value={stop.address_line}
        onChange={(e) => onChange("address_line", e.target.value)}
        wrapperClassName="min-w-0 flex-1 basis-[220px]"
      />
      <Field
        id={`stop-${stop.type}-${index}-city`}
        label="City"
        value={stop.city}
        onChange={(e) => onChange("city", e.target.value)}
        wrapperClassName="w-40 min-w-0"
      />
      <Field
        id={`stop-${stop.type}-${index}-postcode`}
        label="Postcode"
        value={stop.postcode}
        onChange={(e) => onChange("postcode", e.target.value)}
        wrapperClassName="w-32 min-w-0"
      />
      <Button type="button" variant="secondary" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

export default function JobForm({
  form, editingJobId, loading, customers, vehicles, drivers, subcontractors,
  onFieldChange, onStopChange, onAddStop, onRemoveStop, onSubmit, onCancelEdit,
}: Props) {
  return (
    <form onSubmit={onSubmit} className="grid gap-5 rounded-lg border border-line bg-surface p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight text-ink">{editingJobId ? "Edit Job" : "Create Job"}</h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field id="job-reference" label="Reference" value={form.reference} onChange={(e) => onFieldChange("reference", e.target.value)} />
        <Field id="job-date" label="Scheduled date" type="date" value={form.scheduled_date} onChange={(e) => onFieldChange("scheduled_date", e.target.value)} />
        <label className="grid min-w-0 gap-1.5">
          <span className="text-sm font-medium text-ink-2">Customer</span>
          {/* w-full so the select fills its grid track, min-w-0 so it may
              shrink below its longest <option>. Without min-w-0 a long
              option widens the select past its track and it overlaps the
              field beside it. */}
          <select
            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.customer_id}
            onChange={(e) => onFieldChange("customer_id", e.target.value)}
          >
            <option value="">Select customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1.5">
          <span className="text-sm font-medium text-ink-2">Vehicle</span>
          <select
            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.vehicle_id}
            onChange={(e) => onFieldChange("vehicle_id", e.target.value)}
          >
            <option value="">Select vehicle</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-1.5">
          <span className="text-sm font-medium text-ink-2">Driver</span>
          <select
            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.driver_id}
            onChange={(e) => onFieldChange("driver_id", e.target.value)}
          >
            <option value="">Select driver</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <Field id="job-price" label="Customer price" type="number" step="0.01" value={form.customer_price} onChange={(e) => onFieldChange("customer_price", e.target.value)} />
        <label className="grid min-w-0 gap-1.5">
          <span className="text-sm font-medium text-ink-2">Subcontractor</span>
          <select
            className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.subcontractor_id}
            onChange={(e) => onFieldChange("subcontractor_id", e.target.value)}
          >
            <option value="">Select subcontractor</option>
            {subcontractors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <Field id="job-subcost" label="Subcontractor cost" type="number" step="0.01" value={form.subcontractor_cost} onChange={(e) => onFieldChange("subcontractor_cost", e.target.value)} />
      </div>

      <div className="grid gap-3 rounded-md border border-line bg-surface-2 p-4">
        <div>
          <h3 className="m-0 text-sm font-semibold text-ink">
            Driver-hours classification
          </h3>
          <p className="m-0 mt-1 text-xs text-ink-3">
            Record the actual journey facts. Unknown values remain subject to review.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid min-w-0 gap-1.5">
            <span className="text-sm font-medium text-ink-2">
              Journey scope
            </span>
            <select
              className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
              value={form.journey_scope}
              onChange={(event) =>
                onFieldChange("journey_scope", event.target.value)
              }
            >
              <option value="">Unknown / review required</option>
              <option value="gb_domestic">GB domestic</option>
              <option value="uk_eu">UK?EU</option>
              <option value="aetr">AETR</option>
              <option value="international_other">
                Other international
              </option>
            </select>
          </label>

          <Field
            id="job-origin-country"
            label="Origin country"
            maxLength={2}
            placeholder="e.g. GB"
            value={form.origin_country_code}
            onChange={(event) =>
              onFieldChange(
                "origin_country_code",
                event.target.value.toUpperCase()
              )
            }
          />

          <Field
            id="job-destination-country"
            label="Destination country"
            maxLength={2}
            placeholder="e.g. GB"
            value={form.destination_country_code}
            onChange={(event) =>
              onFieldChange(
                "destination_country_code",
                event.target.value.toUpperCase()
              )
            }
          />

          <label className="grid min-w-0 gap-1.5">
            <span className="text-sm font-medium text-ink-2">
              Compliance override
            </span>
            <select
              className="h-10 w-full min-w-0 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
              value={form.compliance_regime_override}
              onChange={(event) =>
                onFieldChange(
                  "compliance_regime_override",
                  event.target.value
                )
              }
            >
              <option value="">None</option>
              <option value="gb_domestic">GB domestic</option>
              <option value="assimilated">Assimilated</option>
              <option value="aetr">AETR</option>
              <option value="international_light_goods">
                International light goods
              </option>
              <option value="exempt">Exempt</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <div className="sm:col-span-2">
            <Field
              id="job-compliance-override-reason"
              label="Override reason"
              placeholder="Required when a compliance override is used"
              value={form.compliance_override_reason}
              onChange={(event) =>
                onFieldChange(
                  "compliance_override_reason",
                  event.target.value
                )
              }
            />
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Collection stops</h3>
        <div className="grid gap-2">
          {form.stops.map((stop, index) =>
            stop.type === "collection" ? (
              <StopRow key={`collection-${index}`} stop={stop} index={index} onChange={(f, v) => onStopChange(index, f, v)} onRemove={() => onRemoveStop(index)} />
            ) : null,
          )}
        </div>
        <Button type="button" variant="ghost" className="mt-2" onClick={() => onAddStop("collection")}>
          + Add collection stop
        </Button>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-ink">Delivery stops</h3>
        <div className="grid gap-2">
          {form.stops.map((stop, index) =>
            stop.type === "delivery" ? (
              <StopRow key={`delivery-${index}`} stop={stop} index={index} onChange={(f, v) => onStopChange(index, f, v)} onRemove={() => onRemoveStop(index)} />
            ) : null,
          )}
        </div>
        <Button type="button" variant="ghost" className="mt-2" onClick={() => onAddStop("delivery")}>
          + Add delivery stop
        </Button>
      </div>

      <div className="flex gap-3">
        <Button type="submit" loading={loading}>
          {editingJobId ? "Update job" : "Add job"}
        </Button>
        {editingJobId ? (
          <Button type="button" variant="secondary" onClick={onCancelEdit}>
            Cancel edit
          </Button>
        ) : null}
      </div>
    </form>
  );
}
