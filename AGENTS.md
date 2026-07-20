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

Development and testing NEVER bill — and since the Storyteller pivot
(PR #117) nothing in the codebase CAN bill: Google is gone, Anthropic
is a dormant fallback behind an explicit `AI_PROVIDER=anthropic` flip.
The discipline stays anyway. Dev servers started for probing run with
`REPLAY_ONLY=1` — AI calls refuse at the budget choke point and routes
degrade to the disk caches in `.ai-cache/` (recorded responses;
gitignored — do not commit or delete). Unit tests are mocked; CI is
keyless. Note: REPLAY_ONLY also refuses FREE Gemini calls, so a dev
server on that flag cannot write new tellings — only replay cached ones.


# AI call-site audit (keep this table true)

Every AI call passes a budget breaker — these are ALL of them. Any new
AI call-site must be added here WITH its cache. Data upstreams
(Wikipedia, Historic England, Open Plaques, Geograph) are keyless or
free-keyed and unmetered — they don't belong in this table.

| Call (kind)          | Cache                    | Cost |
|----------------------|--------------------------|------|
| Gemini telling (ungrounded) | tellings 30d (per story) + device session cache | free tier, 300-calls/day breaker |
| Anthropic (dormant fallback) | n/a — only via explicit AI_PROVIDER=anthropic | paid; assertBudget breaker; boot log asks "is this intended?" |
