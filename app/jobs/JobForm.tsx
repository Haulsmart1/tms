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
        wrapperClassName="min-w-[220px] flex-1"
      />
      <Field
        id={`stop-${stop.type}-${index}-city`}
        label="City"
        value={stop.city}
        onChange={(e) => onChange("city", e.target.value)}
        wrapperClassName="w-40"
      />
      <Field
        id={`stop-${stop.type}-${index}-postcode`}
        label="Postcode"
        value={stop.postcode}
        onChange={(e) => onChange("postcode", e.target.value)}
        wrapperClassName="w-32"
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
    <form onSubmit={onSubmit} className="grid gap-5 rounded-lg border border-line bg-surface p-6">
      <h2 className="text-lg font-semibold text-ink">{editingJobId ? "Edit Job" : "Create Job"}</h2>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field id="job-reference" label="Reference" value={form.reference} onChange={(e) => onFieldChange("reference", e.target.value)} />
        <Field id="job-date" label="Scheduled date" type="date" value={form.scheduled_date} onChange={(e) => onFieldChange("scheduled_date", e.target.value)} />
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-2">Customer</span>
          <select
            className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.customer_id}
            onChange={(e) => onFieldChange("customer_id", e.target.value)}
          >
            <option value="">Select customer</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-2">Vehicle</span>
          <select
            className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.vehicle_id}
            onChange={(e) => onFieldChange("vehicle_id", e.target.value)}
          >
            <option value="">Select vehicle</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-2">Driver</span>
          <select
            className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.driver_id}
            onChange={(e) => onFieldChange("driver_id", e.target.value)}
          >
            <option value="">Select driver</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
        <Field id="job-price" label="Customer price" type="number" step="0.01" value={form.customer_price} onChange={(e) => onFieldChange("customer_price", e.target.value)} />
        <label className="grid gap-1.5">
          <span className="text-sm font-medium text-ink-2">Subcontractor</span>
          <select
            className="h-10 rounded-md border border-ink-3 bg-surface px-3 text-base text-ink"
            value={form.subcontractor_id}
            onChange={(e) => onFieldChange("subcontractor_id", e.target.value)}
          >
            <option value="">Select subcontractor</option>
            {subcontractors.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <Field id="job-subcost" label="Subcontractor cost" type="number" step="0.01" value={form.subcontractor_cost} onChange={(e) => onFieldChange("subcontractor_cost", e.target.value)} />
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
