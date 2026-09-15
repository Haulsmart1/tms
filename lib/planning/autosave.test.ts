import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_DELAY_MS,
  AUTOSAVE_MAX_RETRIES,
  autosaveDelay,
  recordAutosaveFailure,
  type AutosaveFailure,
} from "./autosave";

describe("autosave retry policy (PLAN-7)", () => {
  it("uses the normal debounce with no failure", () => {
    expect(autosaveDelay("s1", null)).toBe(AUTOSAVE_DEBOUNCE_MS);
  });

  it("backs off exponentially for the same snapshot", () => {
    let failure: AutosaveFailure | null = null;
    const delays: Array<number | null> = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      failure = recordAutosaveFailure(failure, "s1", true);
      delays.push(autosaveDelay("s1", failure));
    }

    expect(delays).toEqual([2400, 4800, 9600]);
  });

  it("stops after the retry cap until the next edit", () => {
    let failure: AutosaveFailure | null = null;

    for (let attempt = 0; attempt <= AUTOSAVE_MAX_RETRIES; attempt += 1) {
      failure = recordAutosaveFailure(failure, "s1", true);
    }

    expect(autosaveDelay("s1", failure)).toBeNull();
    // A new edit is a new snapshot: autosave resumes at the normal debounce.
    expect(autosaveDelay("s2", failure)).toBe(AUTOSAVE_DEBOUNCE_MS);
    expect(recordAutosaveFailure(failure, "s2", true).failures).toBe(1);
  });

  it("never retries a non-retryable failure such as a conflict", () => {
    const failure = recordAutosaveFailure(null, "s1", false);

    expect(autosaveDelay("s1", failure)).toBeNull();
  });

  it("caps the delay", () => {
    expect(
      autosaveDelay("s1", { snapshot: "s1", failures: 4, retryable: true })
    ).toBeLessThanOrEqual(AUTOSAVE_MAX_DELAY_MS);
  });
});
