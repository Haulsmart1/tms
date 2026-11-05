import type { CollectionEmailJob, CollectionEmailOptions } from "./collectionEmail";

export const exampleJob: CollectionEmailJob = {
  id: "10000000-0000-4000-8000-000000000001", tenant_id: "20000000-0000-4000-8000-000000000001", reference: "TEST-100", status: "planned",
  job_stops: [{ id: "30000000-0000-4000-8000-000000000001", tenant_id: "20000000-0000-4000-8000-000000000001", type: "collection", stop_order: 1,
    status: "pending", collected_at: null, address_line: "1 Example Street", city: "Example", postcode: "AA1 1AA", contact_name: "Test <Contact>", contact_phone: "01234 567890", contact_email: "COLLECT@example.test" }],
  job_items: [{ description: "Speaker", quantity: 1, serial_numbers: ["FD C10931 0000 0001"] }],
};
export const appointment: CollectionEmailOptions = { kind: "planned_window", date: "2026-11-07", window: "AM", collectedAt: "2026-11-05T10:00:00Z" };

