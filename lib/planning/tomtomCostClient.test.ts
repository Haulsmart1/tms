import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  clearTomTomCostCachesForTests,
  createBudgetedFastPlotCostLoader,
  loadCachedFastPlotCosts,
  loadPointToPointTravelSeconds,
} from "./tomtomCostClient";

afterEach(() => {
  clearTomTomCostCachesForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TomTom planning cost protection", () => {
  it("uses ordinary Routing for a point-to-point driver-hours anchor", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        totalTravelTimeSeconds: 321,
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const result =
      await loadPointToPointTravelSeconds(
        { lat: 51.5, lng: -0.1 },
        { lat: 52.0, lng: -1.0 }
      );

    expect(result).toBe(321);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/tomtom/route"
    );

    expect(
      JSON.parse(
        String(
          fetchMock.mock.calls[0][1]?.body
        )
      )
    ).toEqual({
      points: [
        { lat: 51.5, lng: -0.1 },
        { lat: 52.0, lng: -1.0 },
      ],
    });
  });

  it("caches identical point-to-point Routing requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        totalTravelTimeSeconds: 444,
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const from = {
      lat: 51.5,
      lng: -0.1,
    };

    const to = {
      lat: 52.0,
      lng: -1.0,
    };

    expect(
      await loadPointToPointTravelSeconds(
        from,
        to
      )
    ).toBe(444);

    expect(
      await loadPointToPointTravelSeconds(
        from,
        to
      )
    ).toBe(444);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches identical successful Matrix requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        travelSeconds: [[100, 200]],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const origins = [
      { lat: 51.5, lng: -0.1 },
    ];

    const destinations = [
      { lat: 52.0, lng: -1.0 },
      { lat: 53.0, lng: -2.0 },
    ];

    expect(
      await loadCachedFastPlotCosts(
        origins,
        destinations
      )
    ).toEqual([[100, 200]]);

    expect(
      await loadCachedFastPlotCosts(
        origins,
        destinations
      )
    ).toEqual([[100, 200]]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/tomtom/matrix"
    );
  });

  it("deduplicates identical Matrix requests while one is in flight", async () => {
    type MockResponse = {
      ok: boolean;
      json: () => Promise<{
        travelSeconds: number[][];
      }>;
    };

    let resolveResponse!: (
      value: MockResponse
    ) => void;

    const responsePromise =
      new Promise<MockResponse>((resolve) => {
        resolveResponse = resolve;
      });

    const fetchMock = vi
      .fn()
      .mockReturnValue(responsePromise);

    vi.stubGlobal("fetch", fetchMock);

    const origins = [
      { lat: 51.5, lng: -0.1 },
    ];

    const destinations = [
      { lat: 52.0, lng: -1.0 },
    ];

    const first = loadCachedFastPlotCosts(
      origins,
      destinations
    );

    const second = loadCachedFastPlotCosts(
      origins,
      destinations
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveResponse({
      ok: true,
      json: async () => ({
        travelSeconds: [[123]],
      }),
    });

    await expect(first).resolves.toEqual([[123]]);
    await expect(second).resolves.toEqual([[123]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not cache failed Matrix requests", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          travelSeconds: [[77]],
        }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const origins = [
      { lat: 51.5, lng: -0.1 },
    ];

    const destinations = [
      { lat: 52.0, lng: -1.0 },
    ];

    expect(
      await loadCachedFastPlotCosts(
        origins,
        destinations
      )
    ).toBeNull();

    expect(
      await loadCachedFastPlotCosts(
        origins,
        destinations
      )
    ).toEqual([[77]]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hard-stops Smart Optimize after eight loader calls", async () => {
    const underlying = vi
      .fn()
      .mockResolvedValue([[10]]);

    const budgeted =
      createBudgetedFastPlotCostLoader(
        8,
        underlying
      );

    for (let index = 0; index < 8; index += 1) {
      await expect(
        budgeted(
          [{ lat: 51 + index, lng: -0.1 }],
          [{ lat: 52 + index, lng: -1.0 }]
        )
      ).resolves.toEqual([[10]]);
    }

    await expect(
      budgeted(
        [{ lat: 70, lng: -0.1 }],
        [{ lat: 71, lng: -1.0 }]
      )
    ).resolves.toBeNull();

    expect(underlying).toHaveBeenCalledTimes(8);
  });

  it("rejects an invalid negative Matrix budget", () => {
    expect(() =>
      createBudgetedFastPlotCostLoader(-1)
    ).toThrow(
      "Matrix request budget must be a non-negative integer."
    );
  });

  it("does not call Routing when van and Drop 1 are identical", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const point = {
      lat: 51.5,
      lng: -0.1,
    };

    expect(
      await loadPointToPointTravelSeconds(
        point,
        point
      )
    ).toBe(0);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
