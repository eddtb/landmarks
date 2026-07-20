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


# Billed call-site audit (keep this table true)

Every billed call passes chargeGoogle()/the AI budgets — these are ALL
of them. Any new billed call-site must be added here WITH its cache.

| Call (kind)        | Cache                         | Residual exposure |
|--------------------|-------------------------------|-------------------|
| nearbySearch       | places-lists 1h + prominence-lists 24h (per 100m bucket) | new ground while walking (by design) |
| placeDetails       | place-details 24h (per place) | first tap per venue per day |
| photoNames         | photo-names 12h               | token refresh, ~1p |
| photoMedia         | device image cache (stable URLs) | dev-client reinstall re-bills photos once |
| route              | plan cache 2h; Go mode uncached BY DESIGN (live position) | ~1p per Go open |
| streetView         | uncached (rare no-photo fallback) | trickle, pennies |
| Gemini (all)       | whats-on 14d / busyness 30d / blurb 30d / plan 2h | fresh=1 recompose is a deliberate user action |
