import { expect, it } from "vitest";
import { parseImplicitAuthFragment } from "./implicit";

const fragment = "#access_token=header.payload.signature&refresh_token=fixture-refresh&token_type=bearer&type=invite&expires_in=3600";
it("reads the default Supabase invitation fragment without verifying or consuming it", () => {
  expect(parseImplicitAuthFragment(fragment)).toEqual({ kind: "session", type: "invite", session: { access_token: "header.payload.signature", refresh_token: "fixture-refresh" } });
});
it.each(["", "#access_token=x", fragment + "&refresh_token=duplicate", fragment.replace("type=invite", "type=recovery"), fragment.replace("token_type=bearer", "token_type=other"), "#" + "a".repeat(25000)])("rejects an invalid fragment", fragment => {
  expect(parseImplicitAuthFragment(fragment).kind).toBe("invalid");
});
it("recognises a consumed link without displaying the provider's raw error", () => {
  expect(parseImplicitAuthFragment("#error=access_denied&error_code=otp_expired&error_description=sensitive")).toEqual({ kind: "unavailable" });
});
