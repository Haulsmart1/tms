/** Supabase deliberately cannot distinguish an expired OTP from a consumed one. */
export function authVerificationErrorCode(error: { code?: string } | null): string {
  if (error?.code === "otp_expired") return "link_unavailable";
  if (["pkce_code_verifier_not_found", "bad_code_verifier", "flow_state_not_found", "flow_state_expired"].includes(error?.code ?? "")) {
    return "browser_context";
  }
  return "auth";
}

export function loginErrorMessage(error: string | null): string {
  if (!error) return "";
  if (error === "portal") return "You are signed in, but we could not work out which portal to open. Try again in a moment, or go to your dashboard.";
  if (error === "browser_context" || authVerificationErrorCode({ code: error }) === "browser_context") return "This sign-in could not be completed in this browser. Open the link in the browser where you started signing in, or request a new login link below and open it in your preferred browser.";
  if (error === "auth_config") return "Sign-in is temporarily unavailable. Please try again later or contact your TMS administrator.";
  if (error === "user") return "We could not confirm your signed-in session. Try signing in again; if this continues, contact your TMS administrator.";
  return "This sign-in link has already been used, has expired, or is invalid. Each invitation and login link works once. Switching browsers does not transfer your signed-in session. Enter your existing account email below to request a new login link; you do not need another invitation.";
}
