import { describe, expect, it } from "vitest";
import { pickPortalLink, portalScopeFor, subcontractorColumnsFor } from "./portalScope";

describe("subcontractorColumnsFor", () => {
  it("refuses console drivers (ACC-10)", () => {
    expect(subcontractorColumnsFor("staff", "driver")).toBeNull();
  });

  it("gives staff operational columns without rates", () => {
    const columns = subcontractorColumnsFor("staff", "dispatcher")!;
    expect(columns).toContain("motor_insurance_expiry");
    expect(columns).not.toContain("default_rate");
    expect(columns).not.toContain("*");
  });

  it("gives admins commercial columns too", () => {
    expect(subcontractorColumnsFor("admin", "admin")).toContain("default_rate");
    expect(subcontractorColumnsFor("super_admin", "super_admin")).toContain("vat_number");
  });
});

describe("portalScopeFor", () => {
  it("only lets subcontractor admins see colleagues", () => {
    expect(portalScopeFor("subcontractor_admin").employees).toBe(true);
    for (const role of ["dispatcher", "driver", "accounts"]) {
      expect(portalScopeFor(role).employees).toBe(false);
      expect(portalScopeFor(role).portalUsers).toBe(false);
    }
  });

  it("hides job costs from drivers and everything from unknown roles", () => {
    expect(portalScopeFor("driver").jobCost).toBe(false);
    expect(Object.values(portalScopeFor("mystery")).some(Boolean)).toBe(false);
  });
});

describe("pickPortalLink", () => {
  const links = [
    { id: "b", subcontractor_id: "s2", created_at: "2026-02-01" },
    { id: "a", subcontractor_id: "s1", created_at: "2026-01-01" },
  ];

  it("picks the oldest link by default (no 500 for multi-link users)", () => {
    expect(pickPortalLink(links, null)?.id).toBe("a");
  });

  it("honours a requested link that belongs to the user", () => {
    expect(pickPortalLink(links, "b")?.id).toBe("b");
  });

  it("returns null for a link that is not theirs", () => {
    expect(pickPortalLink(links, "zzz")).toBeNull();
    expect(pickPortalLink([], null)).toBeNull();
  });
});
