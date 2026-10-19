import type { TranslationKey } from "./locales/en";
import type { LocaleId } from "./locale";

const LRI = "\u2066";
const FSI = "\u2068";
const PDI = "\u2069";
const technicalNames = ["Structural Tables (||)", "Structural Tables", "Sheets Extended", "DocWen Assistant", "Word / HTML", "Windows/Linux",
  "structural_table_ids", "structural-tables", "structural_record_id", "<br>", "Obsidian", "Markdown", "Bases", "Base", "DocWen", "Word", "TeX", "GFM", "CSV", "TSV", "HTML", "PNG", "Shift"];
// Reviewed expressions are isolated whole, before their dynamic values are
// substituted. Splitting TeX commands or dimensions would change their order.
const expressions: Partial<Record<TranslationKey, readonly string[]>> = {
  "menu.useMathAbsoluteSuggestion": [String.raw`\lvert … \rvert`],
  "menu.useMathConditionalSuggestion": [String.raw`\mid`],
  "operation.mathPipeUnsafe": ["|", String.raw`\lvert`, String.raw`\rvert`, String.raw`\mid`],
  "operation.mathMultilineUnsafe": [String.raw`\\`],
  "operation.mathSyntaxUnsafe": [String.raw`\$`],
  "operation.transposeUnrepresentable": ["||"],
  "image.ready": ["{width} × {height}"],
  "image.copyUnavailable": ["{width} × {height}"],
  "promotion.blocker.mergedDataCell": ["({rowSpan} × {columnSpan})"],
  "promotion.warning.flattenMultiRowHeaders": ["‘ / ’"],
  "gfm.warning.multipleHeaders": ["« / »"],
};

/** Display strings only: never use this output as source, a path or a value. */
export function arabicDisplayText(key: TranslationKey, text: string): string {
  const literals = [...technicalNames, ...(expressions[key] ?? [])].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(literals.map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|"), "gu");
  let display = text.replace(pattern, `${LRI}$&${PDI}`);
  if (key === "modal.promoteBase.contentRecordTarget") display = display.replace(/\{path\}.*\{key\}/u, `${LRI}$&${PDI}`);
  return display.replace(/\{([a-zA-Z]+)\}/gu, (token, name: string) => `${name === "path" ? LRI : FSI}${token}${PDI}`);
}

/** String-only host Notices cannot contain DOM bdi nodes. */
export function displayPathText(path: string, locale?: LocaleId): string {
  return locale === "ar" ? LRI + path.split(/([/\\])/u).map((part, index) => index % 2 === 0 ? LRI + part + PDI : part).join("") + PDI : path;
}

export function appendDisplayValue(parent: HTMLElement, value: string, direction: "auto" | "ltr" = "auto"): HTMLElement {
  const node = parent.createEl("bdi"); node.dir = direction; node.classList.add("structural-tables-bidi-isolate");
  node.textContent = value; return node;
}

/** Keep path components and separators in source order, including Arabic paths. */
export function appendDisplayPath(parent: HTMLElement, path: string): HTMLElement {
  const node = appendDisplayValue(parent, "", "ltr"); node.dataset.structuralDisplayPath = "true";
  for (const [index, part] of path.split(/([/\\])/u).entries()) {
    if (index % 2 === 0) appendDisplayValue(node, part, "ltr"); else node.append(part);
  }
  return node;
}

export function appendInterfaceTemplate(parent: HTMLElement, template: string, values: Readonly<Record<string, string>>): void {
  let offset = 0;
  for (const match of template.matchAll(/[\u2066\u2068]?\{([a-zA-Z]+)\}\u2069?/gu)) {
    parent.append(template.slice(offset, match.index));
    const name = match[1]!; const value = values[name];
    if (value === undefined) parent.append(match[0]);
    else if (name === "path") appendDisplayPath(parent, value);
    else appendDisplayValue(parent, value);
    offset = match.index + match[0].length;
  }
  parent.append(template.slice(offset));
}
