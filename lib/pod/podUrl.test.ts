import { describe, it, expect } from "vitest";

const BASE = "https://proj.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;

import { classifyPodValue, signPodPath } from "./podUrl";

describe("classifyPodValue", () => {
  it("empty for null or blank", () => {
    expect(classifyPodValue(null).kind).toBe("empty");
    expect(classifyPodValue("   ").kind).toBe("empty");
  });
  it("treats a relative string as a bucket path", () => {
    expect(classifyPodValue("t1/s1/photo.jpg")).toEqual({ kind: "path", path: "t1/s1/photo.jpg" });
  });
  it("self-heals a legacy public URL of our bucket into a path", () => {
    const v = `${BASE}/storage/v1/object/public/pod-files/t1/s1/photo.jpg`;
    expect(classifyPodValue(v)).toEqual({ kind: "path", path: "t1/s1/photo.jpg" });
  });
  it("classifies an arbitrary https URL as external with its host", () => {
    expect(classifyPodValue("https://example.com/x")).toEqual({
      kind: "external", href: "https://example.com/x", host: "example.com",
    });
  });
  it("classifies a javascript: URL as empty (never surfaced)", () => {
    expect(classifyPodValue("javascript:alert(1)").kind).toBe("empty");
  });
});

describe("signPodPath", () => {
  it("returns the signed url on success", async () => {
    const supabase: any = { storage: { from: () => ({
      createSignedUrl: async () => ({ data: { signedUrl: "https://signed" }, error: null }) }) } };
    expect(await signPodPath(supabase, "t1/s1/x.jpg")).toBe("https://signed");
  });
  it("returns null on error", async () => {
    const supabase: any = { storage: { from: () => ({
      createSignedUrl: async () => ({ data: null, error: new Error("nope") }) }) } };
    expect(await signPodPath(supabase, "t1/s1/x.jpg")).toBeNull();
  });
});
