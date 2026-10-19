import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createEvidenceUploadUrl, findEvidenceByPath, recordEvidenceRow } from "./evidenceServer";

const owner = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  jobId: "22222222-2222-4222-8222-222222222222",
  stopId: "33333333-3333-4333-8333-333333333333",
};
const clientId = "44444444-4444-4444-8444-444444444444";

type Result = { data: unknown; error: unknown };

/** Just enough of the admin client for createEvidenceUploadUrl: one pod_evidence lookup and one signing call. */
function fakeAdmin(options: { lookup?: Result; sign?: Result } = {}) {
  const calls = { signed: [] as string[], lookups: 0, tables: [] as string[], eqs: [] as [string, unknown][] };
  const lookup = options.lookup ?? { data: null, error: null };
  const sign = options.sign ?? { data: { token: "signed-token" }, error: null };
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      calls.eqs.push([column, value]);
      return query;
    },
    maybeSingle: async () => {
      calls.lookups += 1;
      return lookup;
    },
  };
  const admin = {
    from: (table: string) => {
      calls.tables.push(table);
      return query;
    },
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
    expect(calls.tables).toEqual(["pod_evidence"]);
    expect(calls.eqs).toEqual(expect.arrayContaining([["tenant_id", owner.tenantId], ["storage_path", result.path]]));
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

describe("recordEvidenceRow persistence ambiguity (real Supabase query builder)", () => {
  const storagePath = `${owner.tenantId}/${owner.jobId}/${owner.stopId}/photos/q-${clientId}-pod.jpg`;
  const input = { ...owner, evidenceType: "photo" as const, storagePath, originalFilename: "pod.jpg", mimeType: "image/jpeg", size: 120, createdBy: clientId };
  const persisted = { id: "e1", tenant_id: owner.tenantId, job_id: owner.jobId, stop_id: owner.stopId, storage_path: storagePath,
    evidence_type: "photo", mime_type: "image/jpeg", file_size_bytes: 120, created_by: clientId, original_filename: "pod.jpg" };

  function sdkAdmin(options: { initial?: unknown; recovered?: unknown; recoveryFails?: boolean; insertStatus?: number; insertBody?: unknown; initialFails?: boolean } = {}) {
    const calls = { removals: 0, inserts: 0, lookups: [] as URL[] };
    const admin = createClient("https://pod-test.example", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (request, init) => {
        const url = new URL(String(request));
        const method = init?.method ?? "GET";
        if (url.pathname === "/rest/v1/pod_evidence" && method === "GET") {
          calls.lookups.push(url);
          if ((calls.lookups.length === 1 && options.initialFails) || (calls.lookups.length > 1 && options.recoveryFails)) {
            return new Response(JSON.stringify({ code: "08006", message: "read unavailable" }), { status: 503 });
          }
          return new Response(JSON.stringify(calls.lookups.length === 1 ? options.initial ?? null : options.recovered ?? null), { status: 200 });
        }
        if (url.pathname === "/rest/v1/pod_evidence" && method === "POST") {
          calls.inserts++;
          return new Response(JSON.stringify("insertBody" in options ? options.insertBody : { code: "23505", message: "duplicate key value" }), { status: options.insertStatus ?? 409 });
        }
        if (url.pathname === "/storage/v1/object/pod-files" && method === "DELETE") {
          calls.removals++;
          return new Response(JSON.stringify([{ name: storagePath }]), { status: 200 });
        }
        throw new Error(`Unexpected request ${method} ${url.pathname}`);
      } },
    });
    return { admin, calls };
  }

  it("acknowledges an insert error only after reading an exact matching row and preserves its object", async () => {
    const { admin, calls } = sdkAdmin({ recovered: persisted });
    expect(await recordEvidenceRow(admin, input)).toEqual(persisted);
    expect(calls.removals).toBe(0);
    expect(calls.lookups).toHaveLength(2);
    for (const url of calls.lookups) {
      expect(url.searchParams.get("tenant_id")).toBe(`eq.${owner.tenantId}`);
      expect(url.searchParams.get("storage_path")).toBe(`eq.${storagePath}`);
    }
  });

  it("recovers a committed insert whose response was replaced by a gateway failure", async () => {
    const { admin, calls } = sdkAdmin({ recovered: persisted, insertStatus: 504, insertBody: { message: "gateway timeout" } });
    expect(await recordEvidenceRow(admin, input)).toEqual(persisted);
    expect(calls.removals).toBe(0);
  });

  it("keeps uploaded bytes and refuses to acknowledge when no persisted row can be read", async () => {
    const { admin, calls } = sdkAdmin();
    await expect(recordEvidenceRow(admin, input)).rejects.toThrow("duplicate key value");
    expect(calls.removals).toBe(0);
  });

  it("keeps uploaded bytes when recovery lookup also fails", async () => {
    const { admin, calls } = sdkAdmin({ recoveryFails: true });
    await expect(recordEvidenceRow(admin, input)).rejects.toThrow();
    expect(calls.removals).toBe(0);
  });

  it("does not return success for a successful HTTP insert with no evidence row", async () => {
    const { admin, calls } = sdkAdmin({ insertStatus: 201, insertBody: null });
    await expect(recordEvidenceRow(admin, input)).rejects.toThrow();
    expect(calls.removals).toBe(0);
  });

  it("does not write or remove bytes after the initial lookup fails", async () => {
    const { admin, calls } = sdkAdmin({ initialFails: true });
    await expect(recordEvidenceRow(admin, input)).rejects.toThrow("read unavailable");
    expect(calls.inserts).toBe(0);
    expect(calls.removals).toBe(0);
  });

  it("returns an ordinary confirmed insert without an extra readback", async () => {
    const { admin, calls } = sdkAdmin({ insertStatus: 201, insertBody: persisted });
    expect(await recordEvidenceRow(admin, input)).toEqual(persisted);
    expect(calls.lookups).toHaveLength(1);
    expect(calls.removals).toBe(0);
  });

  it("reuses an exact matching initial row without inserting or removing bytes", async () => {
    const { admin, calls } = sdkAdmin({ initial: persisted });
    expect(await recordEvidenceRow(admin, input)).toEqual(persisted);
    expect(calls.inserts).toBe(0);
    expect(calls.removals).toBe(0);
  });

  it("does not acknowledge an initial row from another creator", async () => {
    const { admin, calls } = sdkAdmin({ initial: { ...persisted, created_by: "another-user" } });
    await expect(recordEvidenceRow(admin, input)).rejects.toThrow("does not match");
    expect(calls.inserts).toBe(0);
    expect(calls.removals).toBe(0);
  });

  it.each(["tenant_id", "job_id", "stop_id", "storage_path", "evidence_type", "mime_type", "file_size_bytes", "created_by", "original_filename", "id"])(
    "does not acknowledge conflicting persisted %s metadata", async (field) => {
      const recovered = { ...persisted, [field]: field === "id" ? "" : "different" };
      const { admin, calls } = sdkAdmin({ recovered });
      await expect(recordEvidenceRow(admin, input)).rejects.toThrow();
      expect(calls.removals).toBe(0);
    },
  );
});

describe("findEvidenceByPath", () => {
  const path = `${owner.tenantId}/${owner.jobId}/${owner.stopId}/photos/q-${clientId}-pod.jpg`;

  it("looks the row up by tenant and exact storage path", async () => {
    const row = { id: "e1", storage_path: path };
    const { admin, calls } = fakeAdmin({ lookup: { data: row, error: null } });
    expect(await findEvidenceByPath(admin, owner.tenantId, path)).toEqual(row);
    expect(calls.tables).toEqual(["pod_evidence"]);
    expect(calls.eqs).toEqual(expect.arrayContaining([["tenant_id", owner.tenantId], ["storage_path", path]]));
  });

  it("returns null when there is no row and throws when the lookup fails", async () => {
    expect(await findEvidenceByPath(fakeAdmin().admin, owner.tenantId, path)).toBeNull();
    const failing = fakeAdmin({ lookup: { data: null, error: { message: "boom" } } }).admin;
    await expect(findEvidenceByPath(failing, owner.tenantId, path)).rejects.toThrow(/boom/);
  });
});
