// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // Generated output only — dist is the export bundle, .expo holds
    // regenerated router types that carry their own lint directives
    ignores: ["dist/*", ".expo/*"],
  }
]);
