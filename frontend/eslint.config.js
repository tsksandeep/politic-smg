import js from "@eslint/js";

// Minimal flat config; expand with react/typescript plugins as the UI grows.
export default [
  js.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", "coverage/"],
  },
];
