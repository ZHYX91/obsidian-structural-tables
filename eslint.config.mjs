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
    files: [
      "src/app/scheme-settings-renderer.ts",
      "src/app/settings-tab.ts",
      "src/ui/preview-modal.ts",
    ],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/settings-tab/prefer-setting-definitions": "off",
    },
  },
  {
    files: ["src/ui/settings/**/*.ts"],
    rules: {
      "obsidianmd/prefer-create-el": "off",
    },
  },
  {
    files: ["src/config/settings-save-coordinator.ts"],
    rules: {
      "obsidianmd/prefer-window-timers": "off",
    },
  },
  {
    files: [
      "src/app/plugin.ts",
      "src/editor/table-live-preview.ts",
      "src/editor/heading-display-extension.ts",
      "src/reading/table-postprocessor.ts",
      "src/reading/heading-postprocessor.ts",
    ],
    rules: {
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/ui/sentence-case": "off",
    },
  },
]);
