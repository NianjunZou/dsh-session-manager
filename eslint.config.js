import js from "@eslint/js";
export default [
  { ignores: ["node_modules/**", "coverage/**"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "warn",
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-control-regex": "off",
      "no-cond-assign": "off",
      "no-prototype-builtins": "off"
    }
  }
];
