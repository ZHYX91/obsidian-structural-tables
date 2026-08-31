import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const verify = workflow.split("\n  verify:\n", 2)[1]?.split("\n  publish:\n", 1)[0] ?? "";
const publish = workflow.split("\n  publish:\n", 2)[1]?.split("\n  post_verify:\n", 1)[0] ?? "";
const postVerify = workflow.split("\n  post_verify:\n", 2)[1] ?? "";

describe("release workflow boundary", () => {
  it("is manual-only and exposes the exact ten orchestrator inputs", () => {
    const inputs = workflow.match(/ {4}inputs:\n([\s\S]*?)\n\npermissions:/u)?.[1] ?? "";
    const names = [...inputs.matchAll(/^ {6}([a-z][a-z0-9_]+):$/gmu)]
      .map((match) => match[1]);

    expect(names).toEqual([
      "release_run_id",
      "mode",
      "candidate_commit",
      "candidate_digest",
      "candidate_envelope_digest",
      "acceptance_closure_digest",
      "acceptance_closure_b64",
      "release_authorization",
      "authorization_b64",
      "authorization_digest",
    ]);
    expect(workflow).toContain("run-name: release ${{ inputs.release_run_id }}");
    expect(workflow).toContain("default: verify");
    expect(workflow).toContain("          - verify\n          - publish");
    expect(workflow).not.toMatch(/^ {2}(?:push|pull_request|schedule):/mu);
  });

  it("keeps verification read-only and every write behind explicit publish mode", () => {
    expect(verify).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(verify).not.toContain("contents: write");
    expect(publish).toContain(
      "if: github.event_name == 'workflow_dispatch' && github.event.inputs.mode == 'publish'",
    );
    expect(postVerify).toContain(
      "if: always() && github.event_name == 'workflow_dispatch' && github.event.inputs.mode == 'publish'",
    );
    expect(publish).toContain("environment: release");
    expect(publish).toContain("actions: read");
    expect(publish).toContain("attestations: write");
    expect(publish).toContain("contents: write");
    expect(publish).toContain("id-token: write");
    expect(postVerify).toContain("attestations: read");
    expect(postVerify).not.toContain("contents: write");
  });

  it("binds one fixed candidate artifact and the three independent evidence digests", () => {
    expect(verify).toContain("candidate_artifact_id: ${{ steps.handoff.outputs.artifact-id }}");
    expect(verify).toContain(
      "candidate_artifact_digest: ${{ steps.handoff.outputs.artifact-digest }}",
    );
    expect(verify).toContain("name: release-candidate-${{ inputs.release_run_id }}");
    expect(verify).toContain('test "$(sha256sum "$RUNNER_TEMP/release-candidate/candidate.json"');
    expect(publish).toContain(
      "artifact-ids: ${{ needs.verify.outputs.candidate_artifact_id }}",
    );
    expect(publish).toContain("digest-mismatch: error");
    expect(publish).toContain("candidateEnvelopeSha256");
    expect(publish).toContain("closure.releaseCandidate.candidateJsonSha256, candidateDigest");
    expect(publish).toContain("closure.releaseCandidate.candidateJsonSize, candidateBytes.length");
    expect(publish).toContain("assert.notEqual(closure.receipt.sha256, candidateDigest)");
    expect(publish).not.toContain("assert.equal(closure.receipt.sha256, candidateDigest)");
    expect(publish).toContain("authorization.bindings.candidateSha256");
    expect(publish).toContain("authorization.bindings.closureSha256");
    expect(publish).toContain("authorization.bindings.planSha256");
    expect(publish).toContain("closure.gatePassed, true");
    expect(publish).toContain("closure.authorizesPublication, false");
    expect(publish).toContain("authorization.authorizesPublication, true");
    expect(publish).toContain("60_000");
    expect(publish).toContain("16_000");
    expect(publish).not.toContain("console.log");
  });

  it("orders the offline boundary, read-only preflight, writes, and post-verification", () => {
    const boundaryIndex = publish.indexOf("node scripts/release.mjs publication-boundary");
    const preflightIndex = publish.indexOf("node scripts/release.mjs publication-preflight");
    const stagingIndex = publish.indexOf("Stage exact public asset inventory for attestation");
    const attestIndex = publish.indexOf("uses: actions/attest@");
    const publicationIndex = publish.indexOf("node scripts/release.mjs publish-github");

    expect(boundaryIndex).toBeGreaterThan(0);
    expect(preflightIndex).toBeGreaterThan(boundaryIndex);
    expect(stagingIndex).toBeGreaterThan(preflightIndex);
    expect(attestIndex).toBeGreaterThan(stagingIndex);
    expect(publicationIndex).toBeGreaterThan(attestIndex);
    expect(publish.match(/RELEASE_PUBLISH_AUTHORIZATION:/gu)).toHaveLength(3);
    expect(postVerify).toContain("node scripts/release.mjs post-verify");
    expect(workflow).not.toMatch(/git (?:tag|push)/u);
    expect(workflow).not.toContain("gh release create");
  });

  it("emits a validated preflight status and makes the exact branch write-free", () => {
    const preflightStep = workflowStep(publish, "Preflight immutable GitHub Release");
    const stageStep = workflowStep(publish, "Stage exact public asset inventory for attestation");
    const attestStep = workflowStep(publish, "Attest public release assets");
    const publishStep = workflowStep(publish, "Create or prove the exact GitHub Release");
    const missingOnly = "if: steps.publication_preflight.outputs.status == 'missing'";

    expect(preflightStep).toContain("id: publication_preflight");
    expect(preflightStep).toContain("node scripts/release.mjs publication-preflight");
    expect(preflightStep).toContain(
      'assert.ok(result.status === "missing" || result.status === "exact")',
    );
    expect(preflightStep).toContain("printf 'status=%s\\n' \"$status\" >> \"$GITHUB_OUTPUT\"");
    expect(preflightStep).not.toContain("release create");
    expect(stageStep).toContain(missingOnly);
    expect(attestStep).toContain(missingOnly);
    expect(publishStep).toContain(missingOnly);
    expect(postVerify).toContain(
      "if: always() && github.event_name == 'workflow_dispatch' && github.event.inputs.mode == 'publish'",
    );
    expect(postVerify).not.toContain("publication_preflight.outputs.status");
  });

  it("derives the attested public set from candidate inventory and supports optional styles", () => {
    const subjects = publish.match(
      /Attest public release assets[\s\S]*?subject-path:\s*([^\n]+)/u,
    )?.[1] ?? "";

    expect(publish).toContain("candidate.productionAssets.map((record) => record.name)");
    expect(publish).toContain("candidate.archive?.name");
    expect(subjects).toBe("${{ runner.temp }}/release-public-assets/*");
    expect(subjects).not.toContain("styles.css");
    expect(subjects).not.toContain("SHA256SUMS");
    expect(subjects).not.toContain("candidate.json");
    expect(subjects).not.toContain("authorization.json");
  });

  it("pins actions, runner, Node/npm, and disables checkout credentials", () => {
    const actionReferences = [...workflow.matchAll(/uses:\s+[^@\s]+@([^\s#]+)/gu)]
      .map((match) => match[1] ?? "");

    expect(actionReferences.length).toBeGreaterThan(0);
    expect(actionReferences.every((reference) => /^[0-9a-f]{40}$/u.test(reference)))
      .toBe(true);
    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).toContain("node-version-file: .node-version");
    expect(workflow).toContain("npm@11.17.0");
    expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(3);
  });

  it("keeps common validation in check and tag state only in the release gate", () => {
    const checkGraph = expandScript("check");
    const releaseGraph = expandScript("release:check");
    expect(checkGraph).toContain("node scripts/release.mjs validate");
    expect(checkGraph).not.toContain("node scripts/release.mjs validate-tag");
    expect(releaseGraph).toContain("node scripts/release.mjs validate-tag");
  });

  it("keeps every multiline shell block syntactically valid", () => {
    const result = spawnSync("bash", ["-n"], {
      encoding: "utf8",
      input: extractRunBlocks(workflow).join("\n"),
      windowsHide: true,
    });

    expect(result.status, result.stderr).toBe(0);
  }, 30_000);
});

function expandScript(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) return "";
  seen.add(name);
  const command = packageJson.scripts[name] ?? "";
  const nested = [...command.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/gu)]
    .map((match) => expandScript(match[1] ?? "", seen));
  return [command, ...nested].join("\n");
}

function extractRunBlocks(source: string): string[] {
  const lines = source.split(/\r?\n/u);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*\|\s*$/u.exec(lines[index] ?? "");
    if (!match) continue;
    const contentIndent = (match[1]?.length ?? 0) + 2;
    const block: string[] = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.length === 0) {
        block.push("");
        continue;
      }
      const indentation = /^\s*/u.exec(line)?.[0].length ?? 0;
      if (indentation < contentIndent) {
        index -= 1;
        break;
      }
      block.push(line.slice(contentIndent));
    }
    blocks.push(`${block.join("\n")}\n`);
  }
  return blocks;
}

function workflowStep(job: string, name: string): string {
  return job.split(`      - name: ${name}\n`, 2)[1]?.split("\n      - name:", 1)[0] ?? "";
}
