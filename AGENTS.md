# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

# Expo agent skills

The official Expo plugin (`expo@claude-plugins-official`, enabled in
`.claude/settings.json`, installed at project scope) provides `expo-*`
framework skills and `eas-*` service skills. Use the matching skill when
one exists — `eas-hosting` for API-route deployment, `eas-workflows` for
CI/CD YAML, `expo-router`/`expo-dev-client` for framework work. Skills
complement the versioned-docs rule above; they don't replace it.

# Repo skills (.claude/skills/)

This repo's own runbooks, encoded: `verifier-simulator` (UI evidence
via Maestro — use before any UI PR), `record-caches` (the REPLAY_ONLY-
off recording session; needs Edd's go), `device-triage` (Edd's phone
findings → diagnosed, verified, merged PRs), `perf-audit`. Prefer
invoking these over rediscovering their contents.


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


# Shipping: two roads to a phone

A change reaches users one of two ways, and the difference is not a
preference.

**OTA (EAS Update)** — JavaScript, styles, assets. Published
deliberately: `eas workflow:run .eas/workflows/ota-production.yml`.
No review, no wait; also no undo but a rollback publish, so an OTA
carries the same test/lint/typecheck bar as anything else.

**A build** — everything that touches the native runtime: a new native
module, an SDK bump, a permission string, an app.json plugin change.
The `fingerprint` runtimeVersion policy decides which of the two a
change is, by computing the native fingerprint rather than trusting
anyone to remember: change the runtime and old binaries stop being
offered the update instead of crashing on it. When a phone stops
receiving updates, the answer is a new build — never a looser policy.

Server-side API routes are a third road entirely: they reach every
client at once, binary or not. The command is:

```
npx expo export -p web
npx eas-cli deploy --prod --environment production
```

**`--environment production` is not optional.** Without it the worker
deploys with NO server-side environment: no `TURSO_DATABASE_URL`, so
the durable store silently switches off and every cache — tellings,
retellings, feeds — becomes per-isolate memory again. It fails
quietly, exactly like the mode the store is designed to degrade into,
and it cost a day: #231's store was dead in production from the day it
shipped and nobody could tell, because the edge offers no log to read.
The route answers with `x-feed-cache` and `x-feed-store-error` headers
now — `curl -sI` a feed URL after any deploy and read them.


# AI call-site audit (keep this table true)

Every AI call passes a budget breaker — these are ALL of them. Any new
AI call-site must be added here WITH its cache. Data upstreams
(Wikipedia, Historic England, Open Plaques, Geograph) are keyless or
free-keyed and unmetered — they don't belong in this table.

| Call (kind)          | Cache                    | Cost |
|----------------------|--------------------------|------|
| Gemini telling (ungrounded) | tellings 30d (per story + SHA-256 of the extract — a fabricated POST can only poison its own slot): Turso durable store (survives worker recycles; off without TURSO_DATABASE_URL) + per-process map + device session cache, single-flight per key. Retold shares the same store ('retold' kind, incl. 7d no-retell verdicts) | free tier, 300-calls/day breaker |
| Gemini area quiz (ungrounded) | quiz 30d (per area name + SHA-256 of the stories it was set from — a fabricated POST can only poison its own slot): Turso durable store ('quiz' kind, incl. 7d no-quiz verdicts for ground too thin to ask about) + per-process map + device session cache, single-flight per key. Refuses below 3 usable stories WITHOUT calling | free tier, 300-calls/day breaker |
| Valhalla walking route (FOSSGIS) | routes 24h (per ~27m origin bucket + destination) | free community server; 300-calls/day breaker out of politeness |
| Anthropic (dormant fallback) | n/a — only via explicit AI_PROVIDER=anthropic | paid; assertBudget breaker; boot log asks "is this intended?" |
