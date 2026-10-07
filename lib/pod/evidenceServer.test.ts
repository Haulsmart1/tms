import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createEvidenceUploadUrl } from "./evidenceServer";

const owner = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  jobId: "22222222-2222-4222-8222-222222222222",
  stopId: "33333333-3333-4333-8333-333333333333",
};
const clientId = "44444444-4444-4444-8444-444444444444";

type Result = { data: unknown; error: unknown };

/** Just enough of the admin client for createEvidenceUploadUrl: one pod_evidence lookup and one signing call. */
function fakeAdmin(options: { lookup?: Result; sign?: Result } = {}) {
  const calls = { signed: [] as string[], lookups: 0 };
  const lookup = options.lookup ?? { data: null, error: null };
  const sign = options.sign ?? { data: { token: "signed-token" }, error: null };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => {
      calls.lookups += 1;
      return lookup;
    },
  };
  const admin = {
    from: () => query,
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          calls.signed.push(path);
          return sign;
        },
      }),
    },
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

describe("createEvidenceUploadUrl", () => {
  it("signs a timestamp-random path with a string token when the photo is not queued", async () => {
    const { admin, calls } = fakeAdmin();
    const result = await createEvidenceUploadUrl(admin, owner, "photos", "pod.jpg");
    expect(result.token).toBe("signed-token");
    expect(result.path).toMatch(
      new RegExp(`^${owner.tenantId}/${owner.jobId}/${owner.stopId}/photos/\\d+-[0-9a-f-]{36}-pod\\.jpg$`),
    );
    expect(calls.signed).toEqual([result.path]);
    expect(calls.lookups).toBe(0);
  });

  it("signs the client-id path for a queued photo with no row yet", async () => {
    const { admin, calls } = fakeAdmin();
    const result = await createEvidenceUploadUrl(admin, owner, "photos", "pod.jpg", { clientId });
    expect(result).toEqual({ path: `${owner.tenantId}/${owner.jobId}/${owner.stopId}/photos/q-${clientId}-pod.jpg`, token: "signed-token" });
    expect(calls.signed).toEqual([result.path]);
  });

  it("returns token null without signing when a queued photo is already recorded", async () => {
    const { admin, calls } = fakeAdmin({ lookup: { data: { id: "e1" }, error: null } });
    const result = await createEvidenceUploadUrl(admin, owner, "photos", "pod.jpg", { clientId });
    expect(result.token).toBeNull();
    expect(result.path).toContain(`/photos/q-${clientId}-`);
    expect(calls.signed).toEqual([]);
  });

  it("returns token null when storage reports the queued object already exists (409)", async () => {
    const { admin } = fakeAdmin({ sign: { data: null, error: { message: "Conflict", statusCode: "409" } } });
    const result = await createEvidenceUploadUrl(admin, owner, "photos", "pod.jpg", { clientId });
    expect(result.token).toBeNull();
  });

  it("returns token null when storage says the resource already exists", async () => {
    const { admin } = fakeAdmin({ sign: { data: null, error: { message: "The resource already exists" } } });
    const result = await createEvidenceUploadUrl(admin, owner, "photos", "pod.jpg", { clientId });
    expect(result.token).toBeNull();
  });

  it("throws on any other signing error for a queued photo", async () => {
    const { admin } = fakeAdmin({ sign: { data: null, error: { message: "Bucket not found", statusCode: "404" } } });
    await expect(createEvidenceUploadUrl(admin, owner, "photos", "pod.jpg", { clientId })).rejects.toThrow(/Bucket not found/);
  });

  it("throws when the pod_evidence lookup fails for a queued photo", async () => {
    const { admin, calls } = fakeAdmin({ lookup: { data: null, error: { message: "relation missing" } } });
    await expect(createEvidenceUploadUrl(admin, owner, "photos", "pod.jpg", { clientId })).rejects.toThrow(/relation missing/);
    expect(calls.signed).toEqual([]);
  });
});
