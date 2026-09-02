export function assignJobsToLane(
  laneOrders: Record<string, string[]>,
  jobIds: string[],
  vehicleId: string
): Record<string, string[]> {
  const uniqueJobIds = [...new Set(jobIds)];
  const moved = new Set(uniqueJobIds);
  const next: Record<string, string[]> = {};

  for (const [laneId, ids] of Object.entries(laneOrders)) {
    next[laneId] = ids.filter((id) => !moved.has(id));
  }

  const target = next[vehicleId] ?? [];
  const targetIds = new Set(target);

  next[vehicleId] = [
    ...target,
    ...uniqueJobIds.filter((id) => !targetIds.has(id)),
  ];

  return next;
}

export function moveJobInLane(
  laneOrders: Record<string, string[]>,
  vehicleId: string,
  jobId: string,
  offset: -1 | 1
): Record<string, string[]> {
  const lane = laneOrders[vehicleId] ?? [];
  const from = lane.indexOf(jobId);
  const to = from + offset;

  if (from === -1 || to < 0 || to >= lane.length) {
    return laneOrders;
  }

  const reordered = lane.slice();
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];

  return {
    ...laneOrders,
    [vehicleId]: reordered,
  };
}
