import { describe, expect, it } from "vitest";
import { portalInviteMessage, portalLinkDecision } from "./portalInvite";

describe("portalLinkDecision", () => {
  it("links an account with no company", () => {
    expect(portalLinkDecision(null, "c1")).toBe("link");
  });

  it("links an account already in the inviting company", () => {
    expect(portalLinkDecision("c1", "c1")).toBe("link");
  });

  it("never attaches another company's account or a super admin", () => {
    expect(portalLinkDecision("c2", "c1")).toBe("skip");
    expect(portalLinkDecision("super", "c1")).toBe("skip");
    expect(portalLinkDecision("c2", null)).toBe("skip");
  });
});

describe("portalInviteMessage", () => {
  it("does not depend on whether an account existed", () => {
    expect(portalInviteMessage("driver", "a@b.co")).toBe("Driver portal invitation sent to a@b.co.");
    expect(portalInviteMessage("subcontractor", "a@b.co")).toContain("a@b.co");
  });
});
