// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

/**
 * The files allowed to spell a colour out instead of taking a token.
 *
 * Three shapes earn it, and only three: white on a photo scrim (over
 * imagery there is no light mode, only a photograph), a glass or scrim
 * MATERIAL (a token cannot express "20,20,24 at 65%"), and a surface
 * that deliberately commits to one look in both schemes. Every literal
 * inside these files is named, with its reason, in
 * `src/test-utils/design-allowlist.ts`.
 *
 * The split is deliberate: ESLint's granularity is the FILE and it
 * catches a stray hex as you type it; palette-test's granularity is the
 * VALUE and it runs in CI. `palette-test.ts` asserts these two lists
 * name the same files, so neither can quietly forgive something the
 * other refuses.
 */
const FilesWithSanctionedColourLiterals = [
  // Escaped: ESLint globs with minimatch, where [pageId] is a character
  // class matching one of p/a/g/e/I/d — not a directory called [pageId].
  'src/app/history/\\[pageId\\]/index.tsx',
  'src/components/area-gazetteer.tsx',
  'src/components/glass-header.tsx',
  'src/components/history-card.tsx',
  'src/components/image-viewer.tsx',
  'src/components/one-door.tsx',
];

const PaletteMessage =
  'DESIGN.md: "Six colours. Nothing else is allowed in." Use a theme token — ' +
  'theme.text, theme.textSecondary, theme.background, theme.backgroundElement, ' +
  'theme.accent, theme.accentSoft, theme.accentWarm. If this literal is genuinely ' +
  'material (white on a photo scrim, a glass recipe, a deliberate single look), add ' +
  'it to SanctionedColours in src/test-utils/design-allowlist.ts with its reason and ' +
  'exempt the file in eslint.config.js.';

module.exports = defineConfig([
  expoConfig,
  {
    // Generated output only — dist is the export bundle, .expo holds
    // regenerated router types that carry their own lint directives
    ignores: ["dist/*", ".expo/*"],
  },
  {
    // The palette fence, at typing speed. Everything the user sees.
    files: ['src/components/**/*.tsx', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
          message: PaletteMessage,
        },
        {
          selector: 'Literal[value=/^(?:rgba?|hsla?)\\s*\\(/]',
          message: PaletteMessage,
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]',
          message: PaletteMessage,
        },
      ],
    },
  },
  {
    files: FilesWithSanctionedColourLiterals,
    rules: {
      // Value-level truth for these lives in palette-test.ts; see the
      // comment on FilesWithSanctionedColourLiterals above.
      'no-restricted-syntax': 'off',
    },
  },
]);
