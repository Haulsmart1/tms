import { describe, expect, it } from "vitest";
import { buildCustomerSearchFilter, sanitizeSearchTerm } from "./customerSearch";

describe("buildCustomerSearchFilter", () => {
  it("quotes each column's value", () => {
    expect(buildCustomerSearchFilter("acme")).toBe(
      'name.ilike."%acme%",legal_name.ilike."%acme%",trading_name.ilike."%acme%",account_code.ilike."%acme%",postcode.ilike."%acme%"',
    );
  });

  it("keeps reserved characters inside the quoted value (ACC-19 injection)", () => {
    const filter = buildCustomerSearchFilter("a),id.not.is.null")!;
    expect(filter.startsWith('name.ilike."%a),id.not.is.null%",legal_name.ilike.')).toBe(true);
    expect(filter.split('%",')).toHaveLength(5);
  });

  it("cannot break out of the quotes", () => {
    const filter = buildCustomerSearchFilter('x"),id.eq.1,name.ilike.("')!;
    expect(filter).not.toContain('x"');
    expect((filter.match(/"/g) ?? []).length).toBe(10);
  });

  it("escapes LIKE wildcards and drops stars and backslashes", () => {
    expect(sanitizeSearchTerm("100%_\\*")).toBe("100\\\\%\\\\_");
  });

  it("returns null for blank input", () => {
    expect(buildCustomerSearchFilter("   ")).toBeNull();
    expect(buildCustomerSearchFilter('"\\*')).toBeNull();
    expect(buildCustomerSearchFilter(undefined)).toBeNull();
  });

  it("keeps ordinary names with dots and commas", () => {
    expect(buildCustomerSearchFilter("J. Smith, Ltd")).toContain('name.ilike."%J. Smith, Ltd%"');
  });
});
