import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  clearTachographProvidersForTests,
  getTachographProvider,
  listTachographProviders,
  registerTachographProvider,
  type TachographProvider,
} from "./provider";

function provider(id: string): TachographProvider {
  return {
    descriptor: {
      id,
      label: id.toUpperCase(),
      configured: true,
      capabilities: ["activities"],
    },
    async testConnection() {},
    async fetchActivities() {
      return {
        activities: [],
        cursor: null,
      };
    },
  };
}

afterEach(() => {
  clearTachographProvidersForTests();
});

describe("tachograph provider registry", () => {
  it("registers and resolves a provider", () => {
    registerTachographProvider(provider("demo"));

    expect(getTachographProvider("demo")?.descriptor.id)
      .toBe("demo");
  });

  it("lists providers by label", () => {
    registerTachographProvider(provider("zeta"));
    registerTachographProvider(provider("alpha"));

    expect(
      listTachographProviders().map((item) => item.id)
    ).toEqual(["alpha", "zeta"]);
  });

  it("rejects duplicate provider ids", () => {
    registerTachographProvider(provider("demo"));

    expect(() =>
      registerTachographProvider(provider("demo"))
    ).toThrow(/already registered/i);
  });
});
