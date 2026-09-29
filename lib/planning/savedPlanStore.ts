import {
  parseSavedPlanSnapshot,
  savedPlanSummary,
  type SavedPlanRow,
  type SavedPlanSnapshot,
  type SavedPlanSummary,
} from "./savedPlan";

type SupabaseClientLike = {
  from: (table: string) => any;
};

export type LoadedSavedPlan = {
  id: string;
  tenantId: string;
  name: string;
  planningDate: string;
  snapshot: SavedPlanSnapshot;
  createdAt: string;
  updatedAt: string;
};

function normalizeName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    throw new Error("Enter a name for the saved plan.");
  }

  if (normalized.length > 120) {
    throw new Error("Saved plan names can contain up to 120 characters.");
  }

  return normalized;
}

export async function listSavedPlans(
  supabase: SupabaseClientLike,
  tenantId: string,
): Promise<SavedPlanSummary[]> {
  const { data, error } = await supabase
    .from("planning_saved_plans")
    .select(
      "id, tenant_id, planning_date, name, snapshot, created_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Saved plans could not be loaded: ${error.message}`);
  }

  return ((data ?? []) as SavedPlanRow[]).map(savedPlanSummary);
}

export async function createSavedPlan(
  supabase: SupabaseClientLike,
  input: {
    tenantId: string;
    planningDate: string;
    name: string;
    snapshot: SavedPlanSnapshot;
    userId: string;
  },
): Promise<LoadedSavedPlan> {
  const name = normalizeName(input.name);

  const { data, error } = await supabase
    .from("planning_saved_plans")
    .insert({
      tenant_id: input.tenantId,
      planning_date: input.planningDate,
      name,
      snapshot: input.snapshot,
      created_by: input.userId,
    })
    .select(
      "id, tenant_id, planning_date, name, snapshot, created_by, created_at, updated_at",
    )
    .single();

  if (error) {
    throw new Error(`Saved plan could not be created: ${error.message}`);
  }

  return parseLoadedRow(data as SavedPlanRow);
}

export async function loadSavedPlan(
  supabase: SupabaseClientLike,
  tenantId: string,
  id: string,
): Promise<LoadedSavedPlan> {
  const { data, error } = await supabase
    .from("planning_saved_plans")
    .select(
      "id, tenant_id, planning_date, name, snapshot, created_by, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .single();

  if (error) {
    throw new Error(`Saved plan could not be opened: ${error.message}`);
  }

  return parseLoadedRow(data as SavedPlanRow);
}

export async function updateSavedPlanSnapshot(
  supabase: SupabaseClientLike,
  input: {
    tenantId: string;
    id: string;
    planningDate: string;
    snapshot: SavedPlanSnapshot;
  },
): Promise<void> {
  const { error } = await supabase
    .from("planning_saved_plans")
    .update({
      planning_date: input.planningDate,
      snapshot: input.snapshot,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.id);

  if (error) {
    throw new Error(`Saved plan could not be updated: ${error.message}`);
  }
}
export async function renameSavedPlan(
  supabase: SupabaseClientLike,
  tenantId: string,
  id: string,
  name: string,
): Promise<void> {
  const normalizedName = normalizeName(name);

  const { error } = await supabase
    .from("planning_saved_plans")
    .update({
      name: normalizedName,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) {
    throw new Error(`Saved plan could not be renamed: ${error.message}`);
  }
}

export async function deleteSavedPlan(
  supabase: SupabaseClientLike,
  tenantId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from("planning_saved_plans")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);

  if (error) {
    throw new Error(`Saved plan could not be deleted: ${error.message}`);
  }
}

export async function duplicateSavedPlan(
  supabase: SupabaseClientLike,
  tenantId: string,
  id: string,
  userId: string,
): Promise<LoadedSavedPlan> {
  const source = await loadSavedPlan(supabase, tenantId, id);

  return createSavedPlan(supabase, {
    tenantId,
    planningDate: source.planningDate,
    name: `${source.name.slice(0, 115).trimEnd()} copy`,
    snapshot: source.snapshot,
    userId,
  });
}

function parseLoadedRow(row: SavedPlanRow): LoadedSavedPlan {
  const snapshot = parseSavedPlanSnapshot(row.snapshot);

  if (!snapshot) {
    throw new Error(
      "This saved plan is invalid or was created by an unsupported version.",
    );
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    planningDate: row.planning_date,
    snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}