import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
  The shifts_* migrations are pasted by hand into the Supabase SQL editor.
  A lone `$` where `$$` was meant (as $ ... end $;) is not a syntax error the
  editor catches early: it swallows the rest of the file into one string, so
  the transaction aborts half way with a confusing message. These checks catch
  the artefact before anyone pastes the file.
*/
const dir = join(process.cwd(), "docs/sql");
const files = readdirSync(dir).filter((f) => /^shifts_.*\.sql$/.test(f));
const read = (f: string) => readFileSync(join(dir, f), "utf8");

describe("shifts_*.sql dollar quoting", () => {
  it("finds the shifts migrations", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    describe(file, () => {
      const sql = read(file);
      const lines = sql.split(/\r?\n/);

      it("has an even number of $$ tokens", () => {
        const count = (sql.match(/\$\$/g) ?? []).length;
        expect(count % 2).toBe(0);
      });

      it("has no lone $ body delimiter", () => {
        const bad = lines.filter((l) => /(^|\s)(as|do)\s+\$\s*$/i.test(l) || /end\s+\$;/i.test(l));
        expect(bad).toEqual([]);
      });

      it("opens every function body with as $$", () => {
        const chunks = sql.split(/create\s+or\s+replace\s+function/i).slice(1);
        for (const chunk of chunks) {
          expect(chunk, chunk.slice(0, 80)).toMatch(/\bas\s+\$\$/i);
        }
      });

      if (!file.endsWith("_verify.sql")) {
        it("runs in exactly one transaction", () => {
          expect(sql.match(/^begin;/gm) ?? []).toHaveLength(1);
          expect(sql.match(/^commit;/gm) ?? []).toHaveLength(1);
        });
      }
    });
  }
});
