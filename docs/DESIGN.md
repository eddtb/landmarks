# Venture — Design System

The constitution for how Venture looks and speaks. Settled over four mock
rounds and a device-tested implementation sweep (PRs #58–#69); changes to
these rules go through mocks first, code second.

## Identity

A walking companion for London. Confident but quiet: the content (photos,
names, walking times) is the interface; the design's job is to make honest
data legible at a glance and then get out of the way.

## Palette

Six colours. Nothing else is allowed in.

| Token | Light | Dark | Job |
|---|---|---|---|
| `text` (ink) | `#17181A` | `#FFFFFF` | Names, titles, working text |
| `textSecondary` (grey) | `#7B7E85` | `#B0B4BA` | Everything descriptive |
| `background` | `#FFFFFF` | `#000000` | The page |
| `backgroundElement` | `#F2F2F4` | `#212225` | Cards and quiet surfaces |
| `accent` (violet) | `#6A4BDB` | `#A18BF5` | Everything interactive: buttons, links, selection, walk times, the route line, the compass needle |
| `accentSoft` (lavender) | `#EFEAFC` | `#332B52` | Violet's surface tint: chips, dial rings, soft highlights |
| `accentWarm` (orange) | `#F0B429` | `#F6CE5B` | Sparing brand highlights only — a badge, an illustration moment. **Never state, never decoration-by-default.** |

White (`#FFFFFF`) on the accent is the one hardcoded colour allowed in
components — it holds in both modes.

**The rule of use:** if an element isn't interactive and isn't a name, it's
grey. If it's interactive, it's violet. There is no third case.

**State is words and dimming, never colour.** "Open until 11pm", "Closes in
40 min", "Closed" — plain text in the meta line; closed cards dim to 50%.
The semantic colour tokens (green/amber/red) were deliberately deleted so
this can't drift back.

## Typography

One typeface — the system font — everywhere. Hierarchy comes from the
scale, never from a second face.

| Type | Spec | Job |
|---|---|---|
| `largeTitle` | 28/34 · 800 · -0.5 tracking | Place names on their own screen |
| `subtitle` | 32/44 · 600 | The compass dial's big number |
| `headline` | 16/22 · 700 | Card names, sheet instructions |
| `default` | 16/24 · 500 | Longer body text |
| `small` | 14/20 · 500 | Meta lines, facts, section content |
| `smallBold` | 14/20 · 700 | Buttons, emphasis within small |
| `eyebrow` | 11/14 · 800 · +1.4 tracking · uppercase | Section labels: WHAT'S ON · STORY · REVIEWS · DETAILS |
| `linkPrimary` | 14 · accent colour | Inline links |

Unused styles get deleted from `ThemedText`, not abandoned — dead tokens
are how drift starts.

## Screen grammar

Three questions, asked in order; nothing appears on a screen unless it
answers that screen's question.

1. **What is it?** → the browse card: photo (nothing overlaid on it),
   name, one grey meta line — `Pub · 4 min walk · ★ 4.7`. **Openness is
   the default and defaults are silent**: a card says nothing, `Closes in
   40 min` (final hour only), or `Closed` (and dims).
2. **Worth going?** → the venue screen: identity block (reads exactly like
   a card), one violet **Go** button (with the walk time) + Share +
   Compass; the ⋯ overflow (Open in Maps, Call) lives in the header. Then
   sections in the eyebrow grammar, in order: STORY/ABOUT · WHAT'S ON ·
   REVIEWS · DETAILS. Reviews are a Gemini summary with one link deeper;
   weekly hours live behind "All hours" in concise form (`Mon 11am–11pm`),
   Kitchen is its own row beneath Hours.
3. **How do I get there?** → **Go mode**, full screen: the map with the
   violet route, the live instruction in a floating sheet with the compact
   compass dial beside it. The standalone compass is a glance-and-dismiss
   **modal**. Deeper content (all reviews) pushes; tools you dip into
   (compass) present modally.

## Cards

Soft grey surface (`backgroundElement`), 14px corners, no borders, no
shadows, no badges on photos, **no pressed effect** — cards navigate, and
the push transition is the feedback; only buttons flash. Closed places
dim. The photo does the talking.

## Honesty in the interface

- AI-derived content is always labelled at the point of display —
  tersely: "AI-researched" on blurbs, "Summarised with Gemini" on review
  summaries (Google's required attribution). Busyness speaks in Google's
  register — "Usually a little busy" — where **usually** itself is the
  estimate disclosure; forecasts never say **now**.
- Every AI-researched claim carries its source link. No source, no claim;
  an empty section is a correct answer.
- Only the negative is marked: openness is never announced on cards —
  "Closed" on three cards is signal, "Open" on thirty-six is noise. The
  closes-soon window is one hour: at two, every pub near closing time
  would shout at once.

## Process

Mocks before code. Distinct directions to choose between, product-owner
redlines drive revisions, implementation only after the mock would be
screenshotted — and then the mock is the contract: on-device divergence
from the approved page is a bug, not a debate.
