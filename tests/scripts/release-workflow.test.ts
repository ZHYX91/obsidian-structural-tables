import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// @ts-expect-error The generated release runtime is plain ESM.
import { renderReleaseWorkflow } from "../../scripts/vendor/obsidian-release-core.mjs";
// @ts-expect-error The executable adapter is plain ESM.
import { releaseConfig } from "../../scripts/release.mjs";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");
const verify = workflow.split("\n  verify:\n", 2)[1]?.split("\n  publish:\n", 1)[0] ?? "";
const publish = workflow.split("\n  publish:\n", 2)[1]?.split("\n  post_verify:\n", 1)[0] ?? "";
const postVerify = workflow.split("\n  post_verify:\n", 2)[1] ?? "";

describe("generated release workflow boundary", () => {
  it("is byte-identical to release-core generation", () => {
    expect(workflow).toBe(renderReleaseWorkflow(releaseConfig).toString("utf8"));
  });

  it("has the exact manual v3 input surface", () => {
    const inputs = workflow.match(/ {4}inputs:\n([\s\S]*?)\n\npermissions:/u)?.[1] ?? "";
    const names = [...inputs.matchAll(/^ {6}([a-z][a-z0-9_]+):$/gmu)]
      .map((match) => match[1]);
    expect(names).toEqual([
      "release_run_id",
      "mode",
      "candidate_commit",
      "candidate_bundle_digest",
      "acceptance_closure_digest",
      "acceptance_closure_b64",
      "release_authorization",
      "authorization_digest",
      "authorization_b64",
    ]);
    expect(workflow).not.toMatch(/^ {2}(?:push|pull_request|schedule):/mu);
  });

  it("performs one CI rebuild and no dist restoration", () => {
    expect(workflow.match(/npm run release:check/gu)).toHaveLength(1);
    expect(verify).toContain("node scripts/release.mjs bundle");
    expect(verify).toContain("node scripts/release.mjs verify-source --bundle-dir");
    expect(publish).toContain("node scripts/release.mjs verify-transport --bundle-dir");
    expect(postVerify).toContain("node scripts/release.mjs verify-transport");
    expect(workflow).not.toMatch(/Restore exact production assets|mkdir dist|cp .*dist\//u);
    expect(workflow).not.toMatch(/candidate\.json|verify-handoff|--candidate-dir|--handoff-dir/u);
  });

  it("keeps all writes behind explicit publish and verifies hosted bytes", () => {
    expect(verify).not.toContain("contents: write");
    expect(publish).toContain("github.event.inputs.mode == 'publish'");
    expect(publish).toContain("contents: write");
    expect(publish).toContain("node scripts/release.mjs publication-boundary");
    expect(publish).toContain("node scripts/release.mjs publication-preflight");
    expect(publish).toContain("node scripts/release.mjs stage-public-assets");
    expect(publish).toContain("uses: actions/attest@");
    expect(publish).toContain("node scripts/release.mjs publish-github");
    expect(postVerify).toContain("node scripts/release.mjs post-verify");
    expect(workflow).not.toMatch(/git (?:tag|push)|gh release create/u);
  });

  it("pins actions, runner, Node, and npm", () => {
    const pins = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/gu)]
      .map((match) => match[1] ?? "");
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every((pin) => /^[0-9a-f]{40}$/u.test(pin))).toBe(true);
    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).toContain("npm@11.17.0");
    expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(3);
  });
});
