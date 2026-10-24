import { build } from "esbuild";
import os from "node:os";
import { performance } from "node:perf_hooks";

const bundle = await build({
  stdin: { contents: `export { parseEditableTables } from "./src/core/parser";
    export { reparseUnchangedTable, TableDocumentSnapshot } from "./src/core/table-snapshot";
    export { validateTableOperationInDocument } from "./src/core/table-operation-document";
    export { editCellContent } from "./src/core/operations";`, resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
const { parseEditableTables, reparseUnchangedTable, TableDocumentSnapshot, validateTableOperationInDocument, editCellContent } =
  await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

const cases = [{ tables: 20, columns: 4 }, { tables: 200, columns: 8 }, { tables: 80, columns: 30 }];
const results = [];
for (const fixture of cases) {
  const row = "| " + Array.from({ length: fixture.columns }, (_, i) => `列 ${i + 1}`).join(" | ") + " |\n";
  const delimiter = "| " + Array.from({ length: fixture.columns }, () => "---").join(" | ") + " |\n";
  const table = row + delimiter + row.repeat(5);
  const source = Array.from({ length: fixture.tables }, (_, i) =>
    `## 表格 ${i + 1}\n\n${"中文段落用于验证长笔记中的表格边界。".repeat(30)}\n\n${table}\n`).join("\n");
  const expected = parseEditableTables(source).tables[Math.floor(fixture.tables / 2)];
  if (expected === undefined) throw new Error("The benchmark fixture did not parse.");
  const samples = [];
  for (let i = 0; i < 45; i += 1) {
    const started = performance.now();
    const snapshot = new TableDocumentSnapshot(source);
    const current = reparseUnchangedTable(snapshot, expected);
    const result = validateTableOperationInDocument(snapshot, current, editCellContent(current, 1, 1, "已确认输入"));
    if (!result.changed) throw new Error("The benchmark edit was rejected.");
    if (i >= 5) samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  results.push({ ...fixture, sourceBytes: Buffer.byteLength(source), samples: samples.length,
    p50Ms: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.ceil(samples.length * 0.95) - 1],
    longTasksOver50Ms: samples.filter((value) => value > 50).length });
}
process.stdout.write(JSON.stringify({ node: process.version, cpu: os.cpus()[0]?.model,
  scope: "Pure synchronous validation fixture; not native IME or Obsidian runtime acceptance", results }, null, 2) + "\n");
