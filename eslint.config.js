import js from "@eslint/js";
import query from "@tanstack/eslint-plugin-query";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.output/**",
      "**/dist/**",
      "**/coverage/**",
      "src/routeTree.gen.ts",
      "src/vendor/**",
      "supabase/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "preserve-caught-error": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["**/*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    ...query.configs["flat/recommended"][0],
    rules: {
      ...query.configs["flat/recommended"][0].rules,
    },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: reactHooks.configs.flat.recommended.plugins,
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@tanstack/query/exhaustive-deps": "warn",
    },
  },
  {
    files: ["src/contexts/**/*.{jsx,tsx}"],
    rules: { "react-refresh/only-export-components": "off" },
  },
  {
    files: ["src/**/*.{jsx,tsx}"],
    ...reactRefresh.configs.vite,
    rules: {
      ...reactRefresh.configs.vite.rules,
      "react-refresh/only-export-components": "warn",
    },
  },
  prettier,
);
