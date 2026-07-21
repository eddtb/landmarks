---
name: verifier-simulator
description: Verify UI changes on the iOS simulator with Maestro-driven touches and screenshots. Use whenever a change needs runtime evidence at the screen — before any UI PR, and for any "verify this works" request on this Expo app.
---

# Verifying on the simulator

The evidence-capture protocol for this repo's UI surface. A UI PR
without a screenshot from this harness is a claim, not evidence.

## Prerequisites (check, don't assume)

```bash
xcrun simctl list devices booted | grep Booted        # a booted simulator
curl -sf -o /dev/null http://localhost:8081/status    # Metro serving (Edd's dev server)
xcrun simctl listapps booted | grep com.eddtb.landmarks  # the dev build installed
```

- App ID is **com.eddtb.landmarks** (NOT com.anonymous — that's a stale build; uninstall it if seen).
- If a native module is missing at launch ("Cannot find native module 'X'"), the installed
  binary predates a dependency — rebuild: `npx expo run:ios --no-bundler` (~10 min).
- Metro serves **whatever branch this working directory is on** — Edd's phone included.
  Check out the branch under test only while actively probing; return to main after.

## Environment (the traps that cost an hour each)

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk            # maestro needs a JRE macOS doesn't ship
export PATH="$JAVA_HOME/bin:$PATH:/opt/homebrew/opt/maestro/bin"  # formula unlinked (cask shadows it)
export MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED=true
```

**Re-pin the location before EVERY probe run — it does not survive relaunches:**

```bash
xcrun simctl location booted set 51.4826,-0.0077      # Greenwich: warm caches live here
xcrun simctl privacy booted grant location com.eddtb.landmarks   # once per install
```

Symptom of a lost pin: the app sits at "Finding places near you…".

## Driving

Full suite (smoke, lightbox drag-to-close, timeline tap): `scripts/e2e-local.sh` (3 flows, ~50s).

Ad-hoc probes: write a YAML in the scratchpad and run it. Skeleton:

```yaml
appId: com.eddtb.landmarks
---
- launchApp
- runFlow:
    when: { visible: 'Development servers' }
    commands:
      - openLink: exp+landmarks://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081
- extendedWaitUntil: { visible: { id: 'history-card' }, timeout: 45000 }
- takeScreenshot: EVIDENCE-name
```

```bash
maestro test --debug-output <scratch>/shots probe.yaml
# screenshots land under <scratch>/shots/.maestro/tests/<timestamp>/…/takeScreenshot/
```

Stable anchors (testIDs — never assert on story titles, data varies):
`history-card` · `story-screen` · `gazetteer-hero` · `gallery-photo` ·
`image-viewer` · `timeline-stop` · `part-eyebrow` · `reading-progress`

iOS has no back button: `- back` is Android-only; use an edge swipe
`- swipe: { start: 2%, 50%, end: 90%, 50% }`.

Current state without a flow: `xcrun simctl io booted screenshot out.png`.

## Evidence

Read every screenshot (Read tool renders PNGs) and LOOK at it before
claiming anything. Paste what you observed — step results and the
screenshot's contents — into the PR's Evidence section. A step list
that's all happy-path is a replay, not a verification: include at
least one probe off the claim's path.
