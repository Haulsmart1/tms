/* Row shapes for the Tracking console, mirroring the columns app/tracking/page.tsx
   selects. Kept separate from the logic modules so onTheRoad, journey and
   activity can all import them without importing each other. */

export type TrackingStop = {
  id: string;
  stop_order: number;
  type: string | null;
  address_line: string | null;
  city: string | null;
  postcode: string | null;
  /* NOT a real planned time. app/jobs/page.tsx writes it as
     `${scheduled_date}T08:00:00`, so it is accurate to the day and not the
     hour. See lib/pod/overdue.ts, which says the same thing about the same
     column. Render it as a date, never as a time. */
  planned_at: string | null;
  delivered_at: string | null;
  pod_status: string | null;
  recipient_name: string | null;
  pod_updated_at: string | null;
  pod_photo_url: string | null;
  pod_document_url: string | null;
};

export type TrackingJob = {
  id: string;
  reference: string | null;
  status: string | null;
  /** A `date` column, so "YYYY-MM-DD" with no time and no zone. */
  scheduled_date: string | null;
  created_at: string | null;
  customer_name: string | null;
  vehicle_id: string | null;
  vehicle_registration: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  subcontractor_id: string | null;
  stops: TrackingStop[];
};
