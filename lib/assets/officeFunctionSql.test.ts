import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* assets_01 carries its own copy of pod_caller_is_office() so it can be
   applied before or after shifts_06. Two copies of a security check drift
   unless something fails when they do: this is that something. */

function readSql(file: string): string {
  return readFileSync(join(process.cwd(), "docs/sql", file), "utf8").replace(/\r\n/g, "\n");
}

function officeFunction(sql: string): string {
  const start = sql.indexOf("create or replace function public.pod_caller_is_office()");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("end $$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end + "end $$;".length);
}

const assets = readSql("assets_01_archive_and_office_writes.sql");
const shifts = readSql("shifts_06_rectification_and_pod_guards.sql");

describe("assets_01", () => {
  it("carries a byte-identical pod_caller_is_office() to shifts_06", () => {
    expect(officeFunction(assets)).toBe(officeFunction(shifts));
  });

  it("keeps maintenance history when an asset is deleted", () => {
    expect(assets).toMatch(
      /foreign key \(asset_id\) references public\.assets\(id\) on delete restrict/,
    );
  });

  it("drops the maintenance foreign key by lookup, not by name", () => {
    expect(assets).toContain(
      "execute format('alter table public.maintenance_records drop constraint %I', c.conname);",
    );
  });

  it("makes asset numbers unique per tenant", () => {
    expect(assets).toMatch(
      /create unique index if not exists assets_tenant_asset_number_key\s+on public\.assets \(tenant_id, asset_number\)/,
    );
  });

  it("leaves the browser no way to delete assets", () => {
    expect(assets).toContain("revoke delete, truncate on public.assets from public, anon, authenticated;");
    expect(assets).not.toMatch(/create policy \w+ on public\.assets\s+for delete/);
  });

  it("guards the archive columns and archived rows", () => {
    expect(assets).toContain("errcode = 'AST01'");
    expect(assets).toContain("errcode = 'AST02'");
    expect(assets).toContain("errcode = 'AST03'");
  });
});
