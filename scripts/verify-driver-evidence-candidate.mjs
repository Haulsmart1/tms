import { spawnSync } from "node:child_process";

// This is an offline review gate, not a deploy or a live queue reconciliation.
const baseline = "5ea260efaa1cbb9f1e6d52c0240328b725c57323";
const candidate = "34236d3216c49739eb0dcb10daffe0f13b9b0aaa";
const candidateTree = "0b1e3d109161c8c2afebc4b57acff98c738591ea";
const excluded = [
  "4fb93aaaac254cedf238518356521d3c74944860", // GPS PR24
  "d430dc9afef6fdb856b0a16dfce6aae4af40e1bb", // GPS PR28
];
const metadata = new Set([
  "docs/release-review/driver-evidence-20261018.md",
  "scripts/verify-driver-evidence-candidate.mjs",
]);

function git(args, allowed = [0]) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.error || !allowed.includes(result.status)) {
    throw new Error(`Git review check failed: ${args.join(" ")}. Fetch the named reviewed commits if this is a shallow checkout.`);
  }
  return result;
}

try {
  if (git(["status", "--porcelain", "--untracked-files=normal"]).stdout.trim()) throw new Error("Commit or remove unreviewed checkout changes before running the review gate.");
  for (const sha of [baseline, candidate, ...excluded]) git(["cat-file", "-e", `${sha}^{commit}`]);
  if (git(["rev-parse", `${candidate}^{tree}`]).stdout.trim() !== candidateTree) throw new Error("Reviewed source tree does not match.");
  git(["merge-base", "--is-ancestor", baseline, candidate]);
  git(["merge-base", "--is-ancestor", candidate, "HEAD"]);
  for (const sha of excluded) {
    if (git(["merge-base", "--is-ancestor", sha, "HEAD"], [0, 1]).status !== 1) throw new Error(`Release-blocked GPS commit included: ${sha}`);
  }
  const changes = git(["diff", "--name-only", candidate, "HEAD"]).stdout.trim().split("\n").filter(Boolean);
  const unexpected = changes.filter((path) => !metadata.has(path));
  if (unexpected.length) throw new Error(`Runtime/source drift from reviewed candidate: ${unexpected.join(", ")}`);
  const paths = git(["diff", "--name-only", baseline, "HEAD"]).stdout.trim().split("\n");
  if (paths.some((path) => /gps|migration/i.test(path))) throw new Error("GPS or migration change in evidence candidate.");
  git(["diff", "--check", baseline, "HEAD"]);
  console.log(`PASS: exact reviewed code tree ${candidateTree}; GPS PR24/28 excluded; no GPS/migration changes.`);
  console.log("This does not approve deployment, phone acceptance, or any live data/configuration change.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
