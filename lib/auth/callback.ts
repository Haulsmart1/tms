export type AuthCallbackVerificationDecision =
  | "verified"
  | "recover-existing-session"
  | "reject";

export function decideAuthCallbackVerification(
  verificationFailed: boolean,
  hasAuthenticatedUser: boolean,
): AuthCallbackVerificationDecision {
  if (!verificationFailed) {
    return "verified";
  }

  if (hasAuthenticatedUser) {
    return "recover-existing-session";
  }

  return "reject";
}