import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    /* Pinned so timezone-sensitive tests discriminate everywhere, not just on a
       machine that happens to be ahead of UTC. A naive toISOString day would
       otherwise pass every date assertion under a UTC runner.

       Note the cost: this makes TZ identical to OPERATOR_TIME_ZONE, so a
       runtime-local implementation of the operator's day agrees with
       lib/time.ts's operatorDay on every ordinary instant and no test here can
       tell them apart. lib/time.test.ts uses instants that fall on different
       days in UTC and in London precisely to close that gap. */
    env: { TZ: "Europe/London" },
  },
});
