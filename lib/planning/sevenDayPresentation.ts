import type {
  PlanningDriverSchedulePreview,
  PlanningDropEta,
} from "./planningDriverSchedule";
import type { DriverScheduleEvent } from "./driverSchedule";

export type SevenDayActivityTotals = {
  driveSeconds: number;
  serviceSeconds: number;
  breakSeconds: number;
  dailyRestSeconds: number;
  breakCount: number;
  dailyRestCount: number;
};

export type SevenDayPresentationDay = {
  day: number;
  firstDropNumber: number | null;
  lastDropNumber: number | null;
  drops: PlanningDropEta[];
  events: DriverScheduleEvent[];
  totals: SevenDayActivityTotals;
};

function sumDuration(
  events: DriverScheduleEvent[],
  kind: DriverScheduleEvent["kind"]
): number {
  return events.reduce(
    (total, event) =>
      event.kind === kind
        ? total + event.durationSeconds
        : total,
    0
  );
}

export function buildSevenDayPresentation(
  preview: PlanningDriverSchedulePreview
): SevenDayPresentationDay[] {
  return preview.routeDays.map((routeDay) => {
    const first = routeDay.firstTaskIndex;
    const last = routeDay.lastTaskIndex;

    const drops =
      first === null || last === null
        ? []
        : preview.dropEtas.slice(first, last + 1);

    return {
      day: routeDay.day,
      firstDropNumber:
        drops.length > 0 ? drops[0].dropNumber : null,
      lastDropNumber:
        drops.length > 0
          ? drops[drops.length - 1].dropNumber
          : null,
      drops,
      events: routeDay.events,
      totals: {
        driveSeconds: sumDuration(
          routeDay.events,
          "drive"
        ),
        serviceSeconds: sumDuration(
          routeDay.events,
          "service"
        ),
        breakSeconds: sumDuration(
          routeDay.events,
          "break"
        ),
        dailyRestSeconds: sumDuration(
          routeDay.events,
          "daily_rest"
        ),
        breakCount: routeDay.events.filter(
          (event) => event.kind === "break"
        ).length,
        dailyRestCount: routeDay.events.filter(
          (event) => event.kind === "daily_rest"
        ).length,
      },
    };
  });
}
