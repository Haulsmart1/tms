import { isMagicLinkEmailType } from "./confirm";

export type ImplicitSession = { access_token: string; refresh_token: string };
export type ImplicitLink =
  | { kind: "session"; session: ImplicitSession; type: string }
  | { kind: "unavailable" }
  | { kind: "invalid" };

// Shape/size validation only. Supabase must still verify the session server-side.
export function readImplicitSession(params: URLSearchParams | FormData): ImplicitSession | null {
  const access = params.get("access_token");
  const refresh = params.get("refresh_token");
  if (params.getAll("access_token").length !== 1 || params.getAll("refresh_token").length !== 1) return null;
  if (typeof access !== "string" || access.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(access)) return null;
  if (typeof refresh !== "string" || !refresh || refresh.length > 4096 || /\s/.test(refresh)) return null;
  return { access_token: access, refresh_token: refresh };
}

export function parseImplicitAuthFragment(hash: string): ImplicitLink {
  if (!hash || hash.length > 24000) return { kind: "invalid" };
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.has("error") || params.has("error_code")) return { kind: "unavailable" };
  if (params.getAll("type").length !== 1 || !isMagicLinkEmailType(params.get("type"))) return { kind: "invalid" };
  if (params.get("token_type") !== "bearer") return { kind: "invalid" };
  const session = readImplicitSession(params);
  return session ? { kind: "session", session, type: params.get("type")! } : { kind: "invalid" };
}
