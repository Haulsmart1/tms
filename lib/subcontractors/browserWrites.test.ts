import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
  Finding M-4: subcontractors, subcontractor_employees and
  subcontractor_vehicles are written only by app/api/subcontractors/** (service
  role, after an office or manage check). The database revokes the browser's
  DML on them, so a browser write would fail in production. This test fails
  first, in review, if a page or shared component starts writing one again.
*/

const ROOT = join(__dirname, "..", "..");
const TABLES = /\.from\(\s*["'](subcontractors|subcontractor_employees|subcontractor_vehicles)["']\s*\)/g;
const WRITE = /^\s*\.(insert|update|upsert|delete)\s*\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "node_modules" ? [] : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function writesTable(source: string): boolean {
  for (const match of source.matchAll(TABLES)) {
    const after = source.slice((match.index ?? 0) + match[0].length);
    if (WRITE.test(after)) return true;
  }
  return false;
}

describe("subcontractor tables", () => {
  it("are never written from browser code", () => {
    const files = [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))]
      .map((file) => relative(ROOT, file).split("\\").join("/"))
      .filter((file) => !file.startsWith("app/api/"));

    const offenders = files.filter((file) => writesTable(readFileSync(join(ROOT, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("detects a chained write, so the check above can fail", () => {
    expect(writesTable(`supabase.from("subcontractor_vehicles")\n  .update(payload)`)).toBe(true);
    expect(writesTable(`supabase.from("subcontractors").insert([row])`)).toBe(true);
    expect(writesTable(`supabase.from("subcontractors").select("*")`)).toBe(false);
  });
});
