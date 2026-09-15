import { describe, expect, it } from "vitest";
import { portalInviteMessage, portalLinkDecision } from "./portalInvite";

describe("portalLinkDecision", () => {
  it("links an account with no company and no portal links", () => {
    expect(portalLinkDecision(null, "c1", [])).toBe("link");
  });

  it("links an account already in the inviting company", () => {
    expect(portalLinkDecision("c1", "c1", [])).toBe("link");
  });

  it("never attaches another company's account or a super admin", () => {
    expect(portalLinkDecision("c2", "c1", [])).toBe("skip");
    expect(portalLinkDecision("super", "c1", [])).toBe("skip");
    expect(portalLinkDecision("c2", null, [])).toBe("skip");
  });

  it("never attaches a portal-only account that already works for another company", () => {
    // A portal-only driver has no profile, so their company comes only from
    // their existing portal links. Without this, company B could silently
    // attach company A's driver.
    expect(portalLinkDecision(null, "c1", ["c2"])).toBe("skip");
    expect(portalLinkDecision(null, "c1", ["c1", "c2"])).toBe("skip");
  });

  it("links a portal-only account whose existing links are all in the inviting company", () => {
    expect(portalLinkDecision(null, "c1", ["c1"])).toBe("link");
    expect(portalLinkDecision(null, "c1", ["c1", "c1"])).toBe("link");
  });

  it("treats a link on a tenant with no company as foreign", () => {
    expect(portalLinkDecision(null, "c1", [null])).toBe("skip");
  });

  it("refuses to link a portal-only account when the inviter has no company", () => {
    expect(portalLinkDecision(null, null, ["c1"])).toBe("skip");
  });
});

describe("portalInviteMessage", () => {
  it("does not depend on whether an account existed", () => {
    expect(portalInviteMessage("driver", "a@b.co")).toBe("Driver portal invitation sent to a@b.co.");
    expect(portalInviteMessage("subcontractor", "a@b.co")).toContain("a@b.co");
  });
});
