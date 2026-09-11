export type TachographProviderCapability =
  | "activities"
  | "download_files"
  | "driver_list";

export type TachographProviderDescriptor = {
  id: string;
  label: string;
  configured: boolean;
  capabilities: TachographProviderCapability[];
};

export type TachographProviderActivity = {
  externalId: string;
  driverExternalId: string;
  activityType: string;
  activityKind:
    | "driving"
    | "other_work"
    | "availability"
    | "break"
    | "rest"
    | "unknown";
  startTime: string;
  endTime: string;
};

export type TachographProviderFetchResult = {
  activities: TachographProviderActivity[];
  cursor: string | null;
};

export interface TachographProvider {
  readonly descriptor: TachographProviderDescriptor;

  testConnection(): Promise<void>;

  fetchActivities(input: {
    driverExternalId: string;
    cursor: string | null;
  }): Promise<TachographProviderFetchResult>;
}

const providers = new Map<string, TachographProvider>();

export function registerTachographProvider(
  provider: TachographProvider
): void {
  if (!provider.descriptor.id.trim()) {
    throw new Error("Tachograph provider id is required.");
  }

  if (providers.has(provider.descriptor.id)) {
    throw new Error(
      `Tachograph provider ${provider.descriptor.id} is already registered.`
    );
  }

  providers.set(provider.descriptor.id, provider);
}

export function listTachographProviders():
  TachographProviderDescriptor[] {
  return [...providers.values()]
    .map((provider) => provider.descriptor)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function getTachographProvider(
  id: string
): TachographProvider | null {
  return providers.get(id) ?? null;
}

export function clearTachographProvidersForTests(): void {
  providers.clear();
}
