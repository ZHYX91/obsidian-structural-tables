// The package exports its rule modules; @types/markdown-it declares their shared signature.
declare module "markdown-it/lib/rules_inline/backticks.mjs" {
  import type { RuleInline } from "markdown-it/lib/parser_inline.mjs";
  const parseBackticks: RuleInline;
  export default parseBackticks;
}
