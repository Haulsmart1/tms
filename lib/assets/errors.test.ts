import { describe, expect, it } from "vitest";
import {
  ASSET_ARCHIVE_GUARD_MESSAGE,
  ASSET_ARCHIVED_MESSAGE,
  ASSET_OFFICE_ONLY_MESSAGE,
  assetWriteMessage,
  isForeignKeyViolation,
  isMissingColumnError,
} from "./errors";

describe("assetWriteMessage", () => {
  it("explains an edit to an archived asset (AST02)", () => {
    expect(assetWriteMessage({ code: "AST02", message: "raw" })).toBe(ASSET_ARCHIVED_MESSAGE);
  });

  it("explains a browser write to the archive columns (AST01)", () => {
    expect(assetWriteMessage({ code: "AST01", message: "raw" })).toBe(ASSET_ARCHIVE_GUARD_MESSAGE);
  });

  it("explains an RLS refusal (42501) as office-only", () => {
    expect(assetWriteMessage({ code: "42501", message: "new row violates row-level security policy" })).toBe(
      ASSET_OFFICE_ONLY_MESSAGE,
    );
  });

  it("passes any other message through", () => {
    expect(assetWriteMessage({ code: "23505", message: "duplicate key" })).toBe("duplicate key");
  });

  it("falls back when there is nothing usable", () => {
    expect(assetWriteMessage(null)).toBe("Unable to save asset.");
    expect(assetWriteMessage({})).toBe("Unable to save asset.");
    expect(assetWriteMessage({ message: "" }, "Custom.")).toBe("Custom.");
  });
});

describe("error predicates", () => {
  it("recognises a missing column from Postgres or PostgREST", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumnError({ code: "42P01" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });

  it("recognises a foreign key violation", () => {
    expect(isForeignKeyViolation({ code: "23503" })).toBe(true);
    expect(isForeignKeyViolation({ code: "23505" })).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});
