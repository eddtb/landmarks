# Venture — Design System

The constitution for how Venture looks and speaks. Settled over four mock
rounds and a device-tested implementation sweep (PRs #58–#69), then
re-aimed at the Storyteller (mocks artifact f45ffcd7, PRs #117–#120);
changes to these rules go through mocks first, code second.

## Identity

The history of where you stand. Venture tells you what happened on the
ground you're walking — the vanished palace, the plaque, the Grade I
church — and can speak it aloud. Confident but quiet: the content
(photos, names, walking times, the stories themselves) is the interface;
the design's job is to make honest data legible at a glance and then get
out of the way.

## Palette

Six colours. Nothing else is allowed in.

| Token | Light | Dark | Job |
|---|---|---|---|
| `text` (ink) | `#17181A` | `#FFFFFF` | Names, titles, working text |
| `textSecondary` (grey) | `#7B7E85` | `#B0B4BA` | Everything descriptive |
| `background` | `#FFFFFF` | `#000000` | The page |
| `backgroundElement` | `#F2F2F4` | `#212225` | Cards and quiet surfaces |
| `accent` (violet) | `#6A4BDB` | `#A18BF5` | Everything interactive: buttons, links, selection, walk times, the compass needle |
| `accentSoft` (lavender) | `#EFEAFC` | `#332B52` | Violet's surface tint: chips, dial rings, the Listen button |
| `accentWarm` (orange) | `#F0B429` | `#F6CE5B` | Sparing brand highlights only — a badge, an illustration moment. **Never state, never decoration-by-default.** |

White (`#FFFFFF`) on the accent is the one hardcoded colour allowed in
components — it holds in both modes.

**The rule of use:** if an element isn't interactive and isn't a name, it's
grey. If it's interactive, it's violet. There is no third case.

**State is words and dimming, never colour.** The semantic colour tokens
(green/amber/red) were deliberately deleted so this can't drift back.

## Typography

One typeface — the system font — everywhere. Hierarchy comes from the
scale, never from a second face.

| Type | Spec | Job |
|---|---|---|
| `largeTitle` | 28/34 · 800 · -0.5 tracking | Story names on their own screen; the walk's title |
| `subtitle` | 32/44 · 600 | The compass dial's big number |
| `headline` | 16/22 · 700 | Card names |
| `default` | 16/24 · 500 | Longer body text: the story paragraphs |
| `small` | 14/20 · 500 | Meta lines, hooks, tellings |
| `smallBold` | 14/20 · 700 | Buttons, emphasis within small |
| `eyebrow` | 11/14 · 800 · +1.4 tracking · uppercase | Section labels: NEARBY · STORY · AFTER THIS? · WALKS |
| `linkPrimary` | 14 · accent colour | Inline links |

Unused styles get deleted from `ThemedText`, not abandoned — dead tokens
are how drift starts.

## Navigation

Two tabs, two questions: **Nearby** (what can I go see?) and
**History** (what happened here?). Nearby holds the subject-photo
stories — findable, recognisable on arrival — under the approved
header identity: NEARBY over the area name with the violet locator
dot, and a count line, `62 stories within a walk`, fixed with the
header. History is the archive: every story of the ground, photo
optional, on text-first cards with a lavender spine and an honest tag
(NO LONGER STANDING · HIDDEN HISTORY) derived from the record; its
count line reads `41 stories of this ground · 6 no longer standing`.
Story screens push over the tab bar; dip-in tools (compass, Go)
present modally.

Lists scroll under the translucent tab bar but pad their bottom by the
safe-area inset: the last card must always be able to rest fully above
the bar.

**Location-first caching (standing rule).** Every server cache is keyed
by place (area bucket or story id): TTLs govern re-asking about the SAME
thing, never about a new one — as the user moves, results change,
always. Distances and sorting recompute from live GPS on-device. Cost
optimisation may never freeze the user's position.

## Screen grammar

Three questions, asked in order; nothing appears on a screen unless it
answers that screen's question.

1. **What happened here?** → the story card: photo when the record has
   one, name, the hook (the extract's first sentence — "a nuclear
   reactor ran here until 1996" is the reason to tap), one grey meta
   line: `2 min walk · Wikipedia · 🔊`. The 🔊 marks a story with enough
   source text to earn a spoken telling.
2. **Tell me properly.** → the story screen: large title, violet
   **Compass** (with the walk time) + lavender **＋ Walk**; the ⋯
   overflow (Share, Open in Maps) lives in the header. Then STORY in
   the eyebrow grammar: the **Listen** button (`🔊 Listen · about a
   minute`), the telling once written, the source extract, and the
   attribution link. Photo credits (Geograph, CC BY-SA) sit directly
   under the photo.
3. **Walk me there.** → the standalone compass: a glance-and-dismiss
   **modal** — bearing, distance, the violet needle. Vanished palaces
   have coordinates too; the compass is destination-agnostic.

**The telling is the product.** Spoken narration, about a minute,
written once per story by the free-tier model and cached for 30 days.
The voice contract: open with the most surprising true detail — the
thing a listener would repeat to a friend — then earn the context;
never assume the listener is at the site (no "ahead of you" — they may
be at home planning tomorrow's walk); short sentences that read aloud
well; facts only from the source text, a shorter telling over an
invented one. **▶ Play the walk** strings the tellings across the
walk's stops in order — stops without source text are named, not told.

**One place, one card.** A listed building or plaque that matches a
Wikipedia story (proximity + shared name) enriches that story's badge —
`Wikipedia · Grade I listed`, `Wikipedia · plaque` — instead of echoing
it as a second card. The rest stand as their own stories with their own
badges. Stations, plain streets, and piers are gated by title pattern:
infrastructure with an article is not a story.

## Cards

Soft grey surface (`backgroundElement`), 14px corners, no borders, no
shadows, no badges on photos, **no pressed effect** — cards navigate, and
the push transition is the feedback; only buttons flash. The photo does
the talking.

## Honesty in the interface

- Every story names its source in the meta line — Wikipedia, Historic
  England, Open Plaques — and links to the record on its own screen.
  No source, no claim; an empty section is a correct answer.
- The telling is AI-written and bound to its source text: the prompt
  forbids invention, and thin sources get short tellings, not padded
  ones. The source extract and link always sit beside it — the reader
  can check the telling against the record.
- **Subject photo or no card.** A photo must depict the story it sits
  on — the article's own image, or a Commons/Geograph photograph whose
  name matches the story's. A merely-nearby photo is the site, not the
  subject (a vanished theatre's site looks like a station), and a
  listing you can't recognise on arrival is dead weight. Borrowed
  photographs carry their credit where they're shown:
  `Photo: Alan Swain / Geograph (CC BY-SA)`.
- Walking times are straight-line estimates at ~1.33 m/s and say so by
  saying nothing else: no ETAs, no clocks, no dwell.

## Process

Mocks before code. Distinct directions to choose between, product-owner
redlines drive revisions, implementation only after the mock would be
screenshotted — and then the mock is the contract: on-device divergence
from the approved page is a bug, not a debate.
