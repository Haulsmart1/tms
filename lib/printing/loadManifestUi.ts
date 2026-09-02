export type ManifestUiJobItem = {
  id: string;
  serial_numbers: string[] | null;
};

export type ManifestUiJob = {
  id: string;
  reference: string;
  vehicle_id: string | null;
  driver_id: string | null;
  job_items: ManifestUiJobItem[] | null;
};

export type ManifestUiItem = {
  jobId: string;
  jobItemId: string;
  serialNumber: string;
};

export type ManifestAssignment = {
  vehicleId: string;
  driverId: string;
};

export function serializedManifestItemsForJob(
  job: ManifestUiJob,
): ManifestUiItem[] {
  const result: ManifestUiItem[] = [];

  for (const item of job.job_items ?? []) {
    const seen = new Set<string>();

    for (const rawSerial of item.serial_numbers ?? []) {
      const serialNumber = String(rawSerial ?? "").trim();

      if (!serialNumber || seen.has(serialNumber)) {
        continue;
      }

      seen.add(serialNumber);

      result.push({
        jobId: job.id,
        jobItemId: item.id,
        serialNumber,
      });
    }
  }

  return result;
}

export function isMasterLoadEligible(
  job: ManifestUiJob,
): boolean {
  return Boolean(
    job.vehicle_id
    && job.driver_id
    && serializedManifestItemsForJob(job).length > 0,
  );
}

export function manifestAssignmentForJobs(
  jobs: readonly ManifestUiJob[],
): ManifestAssignment | null {
  if (jobs.length === 0) {
    return null;
  }

  const first = jobs[0];

  if (!first.vehicle_id || !first.driver_id) {
    return null;
  }

  if (
    jobs.some(
      (job) =>
        job.vehicle_id !== first.vehicle_id
        || job.driver_id !== first.driver_id,
    )
  ) {
    return null;
  }

  return {
    vehicleId: first.vehicle_id,
    driverId: first.driver_id,
  };
}

export function isCompatibleMasterLoadJob(
  job: ManifestUiJob,
  selectedJobs: readonly ManifestUiJob[],
): boolean {
  if (!isMasterLoadEligible(job)) {
    return false;
  }

  if (selectedJobs.length === 0) {
    return true;
  }

  const assignment =
    manifestAssignmentForJobs(selectedJobs);

  if (!assignment) {
    return false;
  }

  return (
    job.vehicle_id === assignment.vehicleId
    && job.driver_id === assignment.driverId
  );
}

export function buildManifestCreateItems(
  jobs: readonly ManifestUiJob[],
): ManifestUiItem[] {
  const assignment =
    manifestAssignmentForJobs(jobs);

  if (!assignment) {
    throw new Error(
      "Selected jobs must use the same vehicle and driver.",
    );
  }

  const items = jobs.flatMap(
    serializedManifestItemsForJob,
  );

  if (items.length === 0) {
    throw new Error(
      "Select at least one serialized box.",
    );
  }

  const seen = new Set<string>();

  for (const item of items) {
    const key =
      `${item.jobItemId}\u0000${item.serialNumber}`;

    if (seen.has(key)) {
      throw new Error(
        "The manifest contains a duplicate serialized item.",
      );
    }

    seen.add(key);
  }

  return items;
}

export function manifestBoxCount(
  job: ManifestUiJob,
): number {
  return serializedManifestItemsForJob(job).length;
}
