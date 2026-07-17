# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Expo agent skills

The official Expo plugin (`expo@claude-plugins-official`, enabled in
`.claude/settings.json`, installed at project scope) provides `expo-*`
framework skills and `eas-*` service skills. Use the matching skill when
one exists — `eas-hosting` for API-route deployment, `eas-workflows` for
CI/CD YAML, `expo-router`/`expo-dev-client` for framework work. Skills
complement the versioned-docs rule above; they don't replace it.


# Paid APIs: replay-only development

Development and testing NEVER bill. Any dev server started for
probing/verification runs with `REPLAY_ONLY=1` — billed calls
(Google, Anthropic, Gemini) refuse at the budget choke point and
routes degrade to the disk caches in `.ai-cache/` (recorded real
responses; gitignored per Google ToS — do not commit or delete).
Live-billed calls happen only via Edd's app, or an explicitly
costed probe he approves first. Unit tests are mocked; CI is keyless.
