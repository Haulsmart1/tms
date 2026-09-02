import {
  describe,
  expect,
  it,
} from "vitest";
import {
  buildManifestCreateItems,
  isCompatibleMasterLoadJob,
  isMasterLoadEligible,
  manifestAssignmentForJobs,
  manifestBoxCount,
  serializedManifestItemsForJob,
  type ManifestUiJob,
} from "./loadManifestUi";

function job(
  overrides: Partial<ManifestUiJob> = {},
): ManifestUiJob {
  return {
    id: "job-1",
    reference: "JOB-001",
    vehicle_id: "vehicle-1",
    driver_id: "driver-1",
    job_items: [
      {
        id: "item-1",
        serial_numbers: [
          "BOX-001",
          "BOX-002",
        ],
      },
    ],
    ...overrides,
  };
}

describe("Master Load office helpers", () => {
  it("expands serialized boxes from a job", () => {
    expect(
      serializedManifestItemsForJob(job()),
    ).toEqual([
      {
        jobId: "job-1",
        jobItemId: "item-1",
        serialNumber: "BOX-001",
      },
      {
        jobId: "job-1",
        jobItemId: "item-1",
        serialNumber: "BOX-002",
      },
    ]);
  });

  it("trims and deduplicates serials within one item", () => {
    expect(
      serializedManifestItemsForJob(
        job({
          job_items: [
            {
              id: "item-1",
              serial_numbers: [
                " BOX-001 ",
                "BOX-001",
                "",
                "BOX-002",
              ],
            },
          ],
        }),
      ).map((item) => item.serialNumber),
    ).toEqual([
      "BOX-001",
      "BOX-002",
    ]);
  });

  it("requires vehicle driver and serialized freight", () => {
    expect(isMasterLoadEligible(job())).toBe(true);

    expect(
      isMasterLoadEligible(
        job({ vehicle_id: null }),
      ),
    ).toBe(false);

    expect(
      isMasterLoadEligible(
        job({ driver_id: null }),
      ),
    ).toBe(false);

    expect(
      isMasterLoadEligible(
        job({ job_items: [] }),
      ),
    ).toBe(false);
  });

  it("derives a common vehicle and driver", () => {
    expect(
      manifestAssignmentForJobs([
        job(),
        job({
          id: "job-2",
          reference: "JOB-002",
        }),
      ]),
    ).toEqual({
      vehicleId: "vehicle-1",
      driverId: "driver-1",
    });
  });

  it("rejects mixed vehicle assignments", () => {
    expect(
      manifestAssignmentForJobs([
        job(),
        job({
          id: "job-2",
          vehicle_id: "vehicle-2",
        }),
      ]),
    ).toBeNull();
  });

  it("only allows compatible jobs into an established selection", () => {
    const selected = [job()];

    expect(
      isCompatibleMasterLoadJob(
        job({
          id: "job-2",
          reference: "JOB-002",
        }),
        selected,
      ),
    ).toBe(true);

    expect(
      isCompatibleMasterLoadJob(
        job({
          id: "job-3",
          vehicle_id: "vehicle-2",
        }),
        selected,
      ),
    ).toBe(false);
  });

  it("builds multi-job manifest membership", () => {
    const items = buildManifestCreateItems([
      job(),
      job({
        id: "job-2",
        reference: "JOB-002",
        job_items: [
          {
            id: "item-2",
            serial_numbers: ["BOX-003"],
          },
        ],
      }),
    ]);

    expect(items).toHaveLength(3);

    expect(
      new Set(
        items.map((item) => item.jobId),
      ),
    ).toEqual(
      new Set([
        "job-1",
        "job-2",
      ]),
    );
  });

  it("rejects manifest creation without compatible assignment", () => {
    expect(() =>
      buildManifestCreateItems([
        job(),
        job({
          id: "job-2",
          vehicle_id: "vehicle-2",
        }),
      ]),
    ).toThrow(
      "Selected jobs must use the same vehicle and driver.",
    );
  });

  it("counts serialized boxes", () => {
    expect(manifestBoxCount(job())).toBe(2);
  });
});
