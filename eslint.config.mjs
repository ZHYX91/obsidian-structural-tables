import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

const NON_PLUGIN_FILES = ["tests/**/*.ts", "scripts/**/*.mjs", "*.mjs", "*.mts"];
const disabledObsidianRules = Object.fromEntries(
  Object.keys(obsidianmd.rules).map((ruleName) => [`obsidianmd/${ruleName}`, "off"]),
);

export default defineConfig([
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.{ts,mts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: NON_PLUGIN_FILES,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      ...disabledObsidianRules,
      "@microsoft/sdl/no-inner-html": "off",
      "no-undef": "off",
      "no-unsanitized/method": "off",
      "no-unsanitized/property": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        process: "readonly"
      },
    },
  },
  {
    files: ["src/app/settings-tab.ts"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
  {
    // Clipboard HTML leaves Obsidian and uses a detached standard DOM document.
    files: ["src/rendering/table-clipboard.ts"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
    },
  },
  {
    files: [
      "src/app/plugin.ts",
      "src/editor/table-widget.ts",
      "src/reading/table-postprocessor.ts",
    ],
    rules: {
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/ui/sentence-case": "off",
    },
  },
]);
