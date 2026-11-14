export const COLLECTION_FAILURE_REASONS = {
  not_in: "Not in",
  customer_uncontactable: "Uncontactable",
  goods_not_available: "Goods not available",
} as const;

export type CollectionFailureReason = keyof typeof COLLECTION_FAILURE_REASONS;

export function isCollectionFailureReason(value: unknown): value is CollectionFailureReason {
  return typeof value === "string" && Object.hasOwn(COLLECTION_FAILURE_REASONS, value);
}
