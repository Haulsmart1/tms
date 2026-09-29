import type { Tone } from "../../components/Badge";
import type { CheckResult } from "../../lib/walkaround/types";

export function resultTone(result: CheckResult): Tone {
  return result === "dangerous" ? "danger" : result === "minor" ? "warning" : "success";
}
