import { describe, expect, it } from "vitest";
import { parseWarehouseInput, parseWarehouseSearch } from "./input";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const valid = { requestId: id(1), action: "deliver", jobIds: [id(2)] };
describe("warehouse action validation", () => {
  it.each(["collect", "deliver", "reopen", "move"])("accepts %s without an evidence requirement or status allowlist", action => {
    expect(parseWarehouseInput({ ...valid, action }).action).toBe(action);
  });
  it.each([{ action: "delete" }, { requestId: "bad" }, { jobIds: [] }, { jobIds: ["bad"] },
    { jobIds: Array.from({ length: 201 }, (_, i) => id(i + 10)) }, { note: "a".repeat(2001) }, { note: {} },
    { planningDate: "2026-02-30" }, { vehicleId: "bad" }, { driverId: "bad" }, { planId: "bad" }])("rejects malformed request %j", patch => {
    expect(() => parseWarehouseInput({ ...valid, ...patch })).toThrow();
  });
  it("deduplicates and orders IDs for a stable retry payload", () => {
    expect(parseWarehouseInput({ ...valid, jobIds: [id(3), id(2), id(3)] }).jobIds).toEqual([id(2), id(3)]);
  });
  it("needs a destination date, but allows a saved plan to supply it", () => {
    expect(() => parseWarehouseInput({ ...valid, action: "move", vehicleId: id(4) })).toThrow("date");
    expect(parseWarehouseInput({ ...valid, action: "move", vehicleId: id(4), planId: id(5) }).planId).toBe(id(5));
  });
  it("does not permit a driver or plan without a vehicle", () => {
    expect(() => parseWarehouseInput({ ...valid, action: "move", driverId: id(4) })).toThrow("van");
  });
});
describe("warehouse search validation", () => {
  it("keeps exact scanning distinct from contact search", () => {
    expect(parseWarehouseSearch(new URLSearchParams("q=FD+C10930+6860+0134&scan=1"))).toMatchObject({ exact: true, query: "FD C10930 6860 0134" });
    expect(parseWarehouseSearch(new URLSearchParams("q=Harry"))).toMatchObject({ exact: false, filter: "all" });
  });
  it.each(["q=" + "a".repeat(251), "q=a%00b", "page=-1", "page=1.2", "page=NaN", "filter=anything"])("rejects %s", query => {
    expect(() => parseWarehouseSearch(new URLSearchParams(query))).toThrow();
  });
});
