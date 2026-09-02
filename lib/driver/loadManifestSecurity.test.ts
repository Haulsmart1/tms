import {
  readFileSync,
} from "node:fs";
import {
  join,
} from "node:path";
import {
  describe,
  expect,
  it,
} from "vitest";

const root = process.cwd();

const scanMigration = readFileSync(
  join(
    root,
    "supabase/migrations/20260902133000_job_item_scans.sql",
  ),
  "utf8",
);

const manifestMigration = readFileSync(
  join(
    root,
    "supabase/migrations/20260902140000_load_manifests.sql",
  ),
  "utf8",
);

const eventFunctionMarker =
  "create or replace function public.record_load_manifest_event(";

const eventFunctionStart =
  manifestMigration.indexOf(eventFunctionMarker);

const eventFunctionEnd =
  manifestMigration.indexOf(
    "\n$function$;",
    eventFunctionStart,
  );

const eventFunction =
  eventFunctionStart >= 0 && eventFunctionEnd >= 0
    ? manifestMigration.slice(
        eventFunctionStart,
        eventFunctionEnd,
      )
    : "";

describe(
  "barcode and load manifest security",
  () => {
    it(
      "retains barcode verification audit history",
      () => {
        expect(scanMigration).toContain(
          "references public.jobs(id) on delete restrict",
        );

        expect(scanMigration).toContain(
          "references public.job_stops(id) on delete restrict",
        );

        expect(scanMigration).toContain(
          "references public.job_items(id) on delete restrict",
        );

        expect(scanMigration).not.toContain(
          "references public.jobs(id) on delete cascade",
        );

        expect(scanMigration).not.toContain(
          "references public.job_stops(id) on delete cascade",
        );

        expect(scanMigration).not.toContain(
          "references public.job_items(id) on delete cascade",
        );
      },
    );

    it(
      "keeps authenticated barcode audit access read-only",
      () => {
        expect(scanMigration).toContain(
          "create policy job_item_scans_select_tenant",
        );

        expect(scanMigration).not.toMatch(
          /grant\s+(?:[^;]*,\s*)?insert[^;]*job_item_scans/is,
        );
      },
    );

    it(
      "locks the manifest before authorization and transition",
      () => {
        const lock =
          eventFunction.indexOf("for update;");

        const assignment =
          eventFunction.indexOf(
            "from public.vehicle_assignments va",
          );

        const stale =
          eventFunction.indexOf(
            "one or more jobs have been reassigned",
          );

        const transition =
          eventFunction.indexOf(
            "select lse.event_type",
          );

        const insert =
          eventFunction.indexOf(
            "insert into public.load_scan_events",
          );

        expect(lock).toBeGreaterThan(-1);
        expect(assignment).toBeGreaterThan(lock);
        expect(stale).toBeGreaterThan(assignment);
        expect(transition).toBeGreaterThan(stale);
        expect(insert).toBeGreaterThan(transition);
      },
    );

    it(
      "requires exactly one matching active vehicle assignment",
      () => {
        expect(eventFunction).toContain(
          "from public.vehicle_assignments va",
        );

        expect(eventFunction).toContain(
          "and va.driver_id = p_driver_id",
        );

        expect(eventFunction).toContain(
          "and va.active = true",
        );

        expect(eventFunction).toContain(
          "v_active_assignment_count <> 1",
        );

        expect(eventFunction).toContain(
          "v_matching_assignment_count <> 1",
        );
      },
    );

    it(
      "rejects manifests whose jobs were reassigned",
      () => {
        expect(eventFunction).toContain(
          "or j.driver_id is distinct from p_driver_id",
        );

        expect(eventFunction).toContain(
          "or j.vehicle_id is distinct from p_vehicle_id",
        );

        expect(eventFunction).toContain(
          "one or more jobs have been reassigned",
        );
      },
    );

    it(
      "keeps SECURITY DEFINER RPC execution service-role only",
      () => {
        expect(manifestMigration).toContain(
          "security definer",
        );

        expect(manifestMigration).toContain(
          "set search_path = public, pg_temp",
        );

        expect(manifestMigration).toContain(
          ") from public;",
        );

        expect(manifestMigration).toContain(
          ") from anon;",
        );

        expect(manifestMigration).toContain(
          ") from authenticated;",
        );

        expect(manifestMigration).toContain(
          ") to service_role;",
        );
      },
    );
  },
);
