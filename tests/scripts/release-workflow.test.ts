import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/release.yml", "utf8");
const publish = workflow.split("\n  publish:\n", 2)[1] ?? "";

describe("release workflow contract", () => {
  it("keeps manual preflight read-only and publication tag-only", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("Release preflight must run from the repository default branch.");
    expect(workflow).toContain("Release preflight requires a version whose remote tag does not exist.");
    expect(publish).toContain(
      "if: github.event_name == 'push' && needs.verify.outputs.release_exists == 'false'",
    );
  });

  it("accepts only an exact immutable same-tag Release on a safe rerun", () => {
    expect(workflow).toContain("Accept an exact existing immutable Release under read-only permissions");
    expect(workflow).toContain("release_exists: ${{ steps.release_state.outputs.exists }}");
    expect(workflow).toContain(".immutable == true and .draft == false and .prerelease == false");
    expect(workflow).toContain('([.assets[].name] | unique | length) == 4');
    expect(workflow).toContain('cmp --silent "$RUNNER_TEMP/release/$asset" "$existing/$asset"');
    expect(workflow).toContain('gh attestation verify "$existing/$asset"');
    expect(workflow).not.toContain("gh release upload");
    expect(workflow).not.toContain("--clobber");
  });

  it("publishes only the three loose assets and the manual-install ZIP", () => {
    expect(publish).toContain("structural-tables-$GITHUB_REF_NAME.zip");
    expect(publish).toContain("main.js");
    expect(publish).toContain("manifest.json");
    expect(publish).toContain("styles.css");
    expect(publish.match(/subject-path:\s*\|([\s\S]*?)\n\s+- name: Publish GitHub Release/u)?.[1])
      .not.toContain("SHA256SUMS");
  });
});
