import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    /* Pinned so timezone-sensitive tests discriminate everywhere, not just on a
       machine that happens to be ahead of UTC. lib/tracking/onTheRoad.test.ts
       asserts that localDay uses the LOCAL calendar day, which a naive
       toISOString implementation would also satisfy under a UTC runner. */
    env: { TZ: "Europe/London" },
  },
});
