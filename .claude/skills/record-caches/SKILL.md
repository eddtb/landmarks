---
name: record-caches
description: Run a cache-recording session — the server briefly runs WITHOUT REPLAY_ONLY so AI responses (tellings, retellings) get recorded to .ai-cache for replay-only dev to serve. Use when new areas or the per-place gazetteers need retellings. Requires Edd's explicit go — it exercises the live free-tier quota.
---

# Recording AI caches

Dev servers run `REPLAY_ONLY=1`: AI calls refuse and routes serve
`.ai-cache/` recordings. That means new retellings can only be minted
in a deliberate recording session. This is the protocol.

## Before starting — the spend gate

1. **Edd says go, per session.** This is a standing rule (spend
   discipline), not a formality. State what you intend to record.
2. Know the budget truth: Gemini free tier, hard breaker at 300
   calls/day (`gemini-call-ledger`), free quota 500. Anthropic is a
   dormant fallback behind `AI_PROVIDER=anthropic` — never flip it
   casually; its boot log asks "is this intended?" for a reason.
3. Check today's headroom:
   ```bash
   python3 -c "import json; print(json.load(open('.ai-cache/gemini-call-ledger.json')))"
   ```

## The session

Coordinate with Edd — his phone uses the running dev server. Then:

```bash
# stop the replay server, start a recording one (same port)
npx expo start --port 8081        # NO REPLAY_ONLY
```

Record by exercising the routes (each success caches; re-requests hit cache):

```bash
# area retelling (30d cache, key = lowercased name)
curl -s "http://localhost:8081/api/retold?area=Greenwich" | head -c 80
# per-place: list the area's stories, then retell the rich ones opened by users
curl -s "http://localhost:8081/api/history?lat=51.4826&lng=-0.0077" | ...
curl -s "http://localhost:8081/api/retold?area=Cutty%20Sark" | head -c 80
```

Watch the `[ai]` log lines as you go — every call should be visible
and explicable. Economy rules already in the server (do not fight
them): sources under 3,000 chars refuse retelling (stubs keep the
original); failures negative-cache 7 days; thrown calls (breaker,
replay) are never cached — couldn't-try ≠ tried-and-failed.

## After

1. **Restart the server WITH `REPLAY_ONLY=1`.** Leaving a recording
   server running is the failure mode this protocol exists to prevent.
2. Verify replay serves the new recordings (same curl, now on the
   replay server; check `.ai-cache/retold-v2.json` grew).
3. **Never delete or commit `.ai-cache/`** — recorded responses are
   gitignored working assets; billed-cache deletion is unrecoverable
   spend. Version-bump cache names instead when shapes change.
