import js from "@eslint/js";
import tsEslint from "typescript-eslint";

export default [
  js.configs.recommended,
  ...tsEslint.configs.recommended,
  {
    ignores: [".next/**", "node_modules/**", "dist/**", ".agents/**"]
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        browser: true,
        node: true,
        es2022: true
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "vars": "all", "args": "after-used", "ignoreRestSiblings": false }],
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    files: ["server/**/*.js", "*.config.js", "tests/**/*.ts"],
    languageOptions: {
      globals: {
        require: true,
        module: true,
        process: true,
        __dirname: true,
        Buffer: true,
        setTimeout: true,
        setInterval: true,
        clearTimeout: true,
        console: true,
        URL: true
      }
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  }
];
