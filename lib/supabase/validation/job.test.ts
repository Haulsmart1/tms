import { describe, expect, it } from "vitest";
import { JobPageValidation } from "./job";

const job = {
  reference: "JOB-1",
  scheduled_date: new Date(),
  customer_id: "customer",
  driver_id: "",
  vehicle_id: "",
};

describe("job allocation validation", () => {
  it("allows a subcontractor job before its driver and vehicle are assigned", () => {
    expect(JobPageValidation.safeParse({ ...job, subcontractor_id: "subcontractor" }).success).toBe(true);
  });

  it("requires both a driver and vehicle for in-house jobs", () => {
    const result = JobPageValidation.safeParse(job);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["vehicle_id"], ["driver_id"]]);
  });
});
