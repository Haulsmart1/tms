import type { PlanningDriverSchedulePreview, PlanningDropEta } from "./planningDriverSchedule";
import type { DriverScheduleEvent } from "./driverSchedule";

export const MAX_ROUTE_DAYS = 7;

/** A projection of the current scheduler, never a second scheduling engine.
 * A drive may span days; a stop belongs to the day its service completes.
 * Partial work stays visible as events without being claimed as completed. */
export function buildSevenDayPresentation(preview: PlanningDriverSchedulePreview) {
  const completed = new Set(preview.schedule.completedTaskIds);
  const completionDays = new Map<string, number>();
  for (const event of preview.schedule.events) {
    if (event.kind === "service" && event.taskId && completed.has(event.taskId)) completionDays.set(event.taskId, event.day);
  }
  for (const [index, id] of preview.schedule.completedTaskIds.entries()) {
    if (completionDays.has(id)) continue;
    const eta = preview.dropEtas.find((drop) => `stop:${drop.stopId}` === id);
    const etaDay = eta && preview.schedule.days.find((day) => eta.serviceEndSeconds >= day.startSeconds && eta.serviceEndSeconds <= day.endSeconds)?.day;
    const previousDay = completionDays.get(preview.schedule.completedTaskIds[index - 1]);
    const nextId = preview.schedule.completedTaskIds.slice(index + 1).find((taskId) => completionDays.has(taskId));
    const day = etaDay || previousDay || (nextId && completionDays.get(nextId)) || preview.schedule.days[0]?.day;
    if (day) completionDays.set(id, day);
  }
  return Array.from({ length: MAX_ROUTE_DAYS }, (_, index) => {
    const day = index + 1;
    const events = preview.schedule.events.filter((event) => event.day === day);
    const taskIds = preview.schedule.completedTaskIds.filter((id) => completionDays.get(id) === day);
    const drops: PlanningDropEta[] = preview.dropEtas.filter((drop) => completed.has(`stop:${drop.stopId}`) && taskIds.includes(`stop:${drop.stopId}`));
    const duration = (kind: DriverScheduleEvent["kind"]) => events.filter((event) => event.kind === kind).reduce((total, event) => total + event.durationSeconds, 0);
    return {
      day, events, taskIds, drops,
      scheduleDay: preview.schedule.days.find((value) => value.day === day),
      totals: {
        driveSeconds: duration("drive") + duration("return_to_base"),
        serviceSeconds: duration("service"), breakSeconds: duration("break"),
        dailyRestSeconds: duration("daily_rest"),
        breakCount: events.filter((event) => event.kind === "break").length,
        dailyRestCount: events.filter((event) => event.kind === "daily_rest").length,
      },
    };
  });
}

export function remainingSevenDayTaskIds(preview: PlanningDriverSchedulePreview, canonicalTaskIds: string[]) {
  const visible = new Set(buildSevenDayPresentation(preview).flatMap((day) => day.taskIds));
  return canonicalTaskIds.filter((id) => !visible.has(id));
}
