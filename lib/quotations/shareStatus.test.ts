import { describe, expect, it } from "vitest";
import {
  QuotationShareError,
  SHARE_MESSAGES,
  publicRpcErrorMessage,
  publicShareError,
  quotationShareState,
} from "./shareStatus";

const TODAY = "2026-09-14";

describe("quotationShareState", () => {
  it("is open for a sent or draft quotation still inside its validity", () => {
    expect(quotationShareState({ quotationStatus: "sent", validUntil: TODAY, today: TODAY })).toEqual({ state: "open" });
    expect(quotationShareState({ quotationStatus: "draft", validUntil: null, today: TODAY })).toEqual({ state: "open" });
  });

  it("closes once the operator cancels or expires the quotation", () => {
    expect(quotationShareState({ quotationStatus: "cancelled", validUntil: null, today: TODAY })).toEqual({
      state: "closed",
      reason: "cancelled",
    });
    expect(quotationShareState({ quotationStatus: "Expired", validUntil: null, today: TODAY })).toEqual({
      state: "closed",
      reason: "expired",
    });
  });

  it("closes the day after valid_until, even if the link row has not expired", () => {
    expect(quotationShareState({ quotationStatus: "sent", validUntil: "2026-09-13", today: TODAY })).toEqual({
      state: "closed",
      reason: "expired",
    });
  });

  it("reports accepted and declined from either the link or the quotation", () => {
    expect(quotationShareState({ quotationStatus: "sent", validUntil: null, shareAcceptedAt: "x", today: TODAY })).toEqual({
      state: "accepted",
    });
    expect(quotationShareState({ quotationStatus: "declined", validUntil: null, today: TODAY })).toEqual({ state: "declined" });
  });

  it("closes an unknown status or a quotation already converted to a job", () => {
    expect(quotationShareState({ quotationStatus: "archived", validUntil: null, today: TODAY })).toEqual({
      state: "closed",
      reason: "unavailable",
    });
    expect(quotationShareState({ quotationStatus: "sent", validUntil: null, convertedJobId: "j1", today: TODAY })).toEqual({
      state: "closed",
      reason: "unavailable",
    });
  });
});

describe("public error mapping", () => {
  it("passes known share errors through and hides everything else", () => {
    expect(publicShareError(new QuotationShareError("revoked", 410))).toEqual({
      message: SHARE_MESSAGES.revoked,
      status: 410,
    });
    expect(publicShareError(new Error("QUOTATION_SHARE_SECRET must be configured with at least 32 characters."))).toEqual({
      message: SHARE_MESSAGES.generic,
      status: 500,
    });
  });

  it("shows RPC business messages verbatim and replaces database detail", () => {
    expect(publicRpcErrorMessage("ADR Dangerous Goods acceptance is required.")).toBe(
      "ADR Dangerous Goods acceptance is required."
    );
    expect(publicRpcErrorMessage('null value in column "tenant_id" violates not-null constraint')).toBe(
      SHARE_MESSAGES.genericDecision
    );
    expect(publicRpcErrorMessage(undefined)).toBe(SHARE_MESSAGES.genericDecision);
  });
});
