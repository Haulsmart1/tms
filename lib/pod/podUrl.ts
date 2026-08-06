import type { SupabaseClient } from "@supabase/supabase-js";

export const POD_BUCKET = "pod-files";

export type PodValue =
  | { kind: "empty" }
  | { kind: "external"; href: string; host: string }
  | { kind: "path"; path: string };

function publicPrefix(): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return base ? `${base}/storage/v1/object/public/${POD_BUCKET}/` : "";
}

// Decide how to present a stored POD value:
//  - our own bucket's legacy PUBLIC url -> recover the object path and sign it (self-heal)
//  - a relative string -> a bucket object path -> sign it
//  - an arbitrary http(s) url (jobs paste) -> a labeled external link, never auto-opened
//  - anything else (empty, javascript:, data:, other schemes) -> empty (never surfaced)
export function classifyPodValue(value: string | null | undefined): PodValue {
  if (!value || !value.trim()) return { kind: "empty" };
  const v = value.trim();

  const prefix = publicPrefix();
  if (prefix && v.startsWith(prefix)) {
    const path = decodeURIComponent(v.slice(prefix.length).split("?")[0]);
    return path ? { kind: "path", path } : { kind: "empty" };
  }

  let parsed: URL | null = null;
  try { parsed = new URL(v); } catch { parsed = null; }
  if (parsed) {
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { kind: "external", href: parsed.toString(), host: parsed.host };
    }
    return { kind: "empty" };
  }
  return { kind: "path", path: v };
}

export async function signPodPath(
  supabase: SupabaseClient,
  path: string,
  ttlSeconds = 300,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(POD_BUCKET).createSignedUrl(path, ttlSeconds);
  return error ? null : (data?.signedUrl ?? null);
}
