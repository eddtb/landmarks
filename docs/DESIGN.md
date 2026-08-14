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
| `textSecondary` (grey) | `#6B6E76` | `#B0B4BA` | Everything descriptive |
| `background` | `#FFFFFF` | `#000000` | The page |
| `backgroundElement` | `#F2F2F4` | `#212225` | Cards and quiet surfaces |
| `accent` (violet) | `#6A4BDB` | `#A18BF5` | Everything interactive: buttons, links, selection, walk times, the compass needle |
| `accentSoft` (lavender) | `#EFEAFC` | `#332B52` | Violet's surface tint: chips, dial rings, the Listen button |
| `accentWarm` (orange) | `#F0B429` | `#F6CE5B` | Sparing brand highlights only — a badge, an illustration moment. **Never state, never decoration-by-default.** |

**White is for photo scrims, not for the accent.** Over a scrimmed
photograph white is the one hardcoded colour allowed in components — it
holds on any image. On the accent it does not: `#FFFFFF` on the light
accent is 5.77:1, but on the dark accent (`#A18BF5`) it is **2.79:1**,
under AA for anything that isn't large text. Text on an accent surface
takes `theme.background`, which reads 5.77:1 light and 7.53:1 dark.

**The rule of use:** if an element isn't interactive and isn't a name, it's
grey. If it's interactive, it's violet. There is no third case.

**State is words and dimming, never colour.** The semantic colour tokens
(green/amber/red) were deliberately deleted so this can't drift back.

## Typography

One typeface — the system font — everywhere. Hierarchy comes from the
scale, never from a second face.

| Type | Spec | Job |
|---|---|---|
| `display` | 34/38 · 800 · -0.5 tracking | The one-door gate's brand moment — the largest text anywhere |
| `largeTitle` | 28/34 · 800 · -0.5 tracking | Story names on their own screen; the quiz score |
| `title` | 21/27 · 700 | Reading headings: a part's title, a quiz question |
| `pullQuote` | 18/25 · 500 | The repeatable line, lifted out of its part |
| `lede` | 17.5/27 · 500 | A story's opening paragraph |
| `headline` | 16/22 · 700 | Card names |
| `default` | 16/24 · 500 | Longer body text: the story paragraphs |
| `small` | 14/20 · 500 | Meta lines, hooks, tellings |
| `smallBold` | 14/20 · 700 | Buttons, emphasis within small |
| `eyebrow` | 11/14 · 800 · +1.4 tracking · uppercase | Section labels: NEARBY · STORY · IN BRIEF |
| `caption` | 11/14 · 500 | Credits, bylines, hints, download states — the finest print |
| `captionBold` | 11/14 · 700 | Fine print that must carry: the read tick |
| `linkPrimary` | 14 · accent colour | Inline links |

Unused styles get deleted from `ThemedText`, not abandoned — dead tokens
are how drift starts (`subtitle` died 2026-08-06 when the quiz question
moved to `title`). Two sanctioned inline sizes remain, each commented at
the site: the search `TextInput` (15 — inputs live outside ThemedText)
and the compass dial's two geometry-bound sizes, 32 and 10 — the dial's
fixed ring sizes its own number, so those glyphs live outside the ramp.

**Dynamic type: reading scales freely, chrome is capped.** `default`,
`small`, `lede`, `pullQuote`, `title` — the story voice — follow the
user's text size without limit: long-form history readers are exactly
the large-type audience. The chrome types (`eyebrow`, `smallBold`,
`largeTitle`, `display`) and any sanctioned fixed-frame text (the
compact dial, the featured cards, the hero) cap at 1.4× so
accessibility sizes never clip a fixed-height surface.

**Controls are words, not glyphs.** A tappable label is a word VoiceOver
can say — Stop, Close, Steps — never `◼`, `✕`, or a triangle (the rule
PR #186 settled). Decorative marks may ride beside a word only if the
accessible label excludes them; expand/collapse controls carry
`accessibilityState: {expanded}`, and every tap target clears 44pt.

## Navigation

Four tabs, four questions: **Nearby** (what can I go see?), **Saved**
(what did I keep?), **History** (what happened here?) and **Quiz**
(what do I actually know?). Nearby holds the subject-photo stories —
findable, recognisable on arrival — under the approved header
identity: NEARBY over the area name with the violet locator dot, and
a count line, `62 stories within a walk`, fixed with the header.
Saved is the shelf the user fills: Save on any story keeps it, newest
first, with one Keep offline switch that downloads the shelf; empty is
a state, not a failure. History is the archive as Gazetteer: the
area's own illustrated story, retold, with the relics of its ground
beneath — photo optional, on cards with a lavender spine and an honest
tag (NO LONGER STANDING · PLAQUE) derived from the record. Quiz asks
about the ground the feed just described, and is the only surface
where the app asks rather than tells; it is wholly derived from
Nearby's stories and says so by refusing below three of them. Story
screens push over the tab bar; dip-in tools (compass, Go) present
modally.

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
   line: `2 min walk · Wikipedia`. No speaker glyph — a story that can
   be spoken says so in a word, on its own screen, not in a mark on a
   card (PR #186).
2. **Tell me properly.** → the story screen: the name in `largeTitle`,
   always, whether or not an article resolved; violet **Go** carrying
   the walk time, then **Compass** and **Save**; the ⋯ overflow
   (Privacy, Support, Share) lives in the island. Then STORY in the
   eyebrow grammar: the **Listen** button (`Listen · about a minute`),
   the telling once written, the source extract, and the attribution
   link. Photo credits (Geograph, CC BY-SA) sit directly under the
   photo.
3. **Walk me there.** → the standalone compass: a glance-and-dismiss
   **modal** — bearing, distance, the violet needle. Vanished palaces
   have coordinates too; the compass is destination-agnostic.

   **Two doors to the same walk, on purpose** (#250, decided
   2026-08-14). The compass is the glance — bearing and distance,
   dismissed in a second, mid-story. Go is the journey — the route,
   the steps, the dial embedded. They overlap by design and the
   overlap is the feature; neither replaces the other, and the next
   reviewer who notices the redundancy is reading this sentence
   instead of filing the issue again.

**The telling is the product.** Spoken narration, about a minute,
written once per story by the free-tier model and cached for 30 days.
The voice contract: open with the most surprising true detail — the
thing a listener would repeat to a friend — then earn the context;
never assume the listener is at the site (no "ahead of you" — they may
be at home planning tomorrow's walk); short sentences that read aloud
well; facts only from the source text, a shorter telling over an
invented one. The retelling is the same contract at the scale of an
area: parts in sequence, each earning its place, streamed as they are
written rather than withheld until the whole is ready.

**One place, one card.** A listed building or plaque that matches a
Wikipedia story (proximity + shared name) enriches that story's badge —
`Wikipedia · Grade I listed`, `Wikipedia · plaque` — instead of echoing
it as a second card. The rest stand as their own stories with their own
badges. Stations, plain streets, and piers are gated by title pattern:
infrastructure with an article is not a story.

## Cards

Soft grey surface (`backgroundElement`), 14px corners, no shadows, **no
pressed effect** — cards navigate, and the push transition is the
feedback; only buttons flash. The photo does the talking.

Two marks are allowed on a card, and only two. The archive's **lavender
spine** is a tag, not a frame — it is the one border a card may wear, and
it says which shelf the card came from. The **journal tick** is the one
mark the app may put on a photograph, and it carries a word (`✓ Read`,
`✓ Visited today`), never a bare glyph. Nothing else: no badges, no
ribbons, no counts over the image.

## Glass

The chrome floats; the content does not. Added 2026-08-06 and after,
device-driven — every rule here was found on Edd's phone, because the
simulator's binary has no such module and cannot contradict you.

**Glass is for chrome that sits over content it does not own.** A screen
header, a back chip on a photograph, the Go sheet over the map. Cards,
feeds, story prose and every reading surface stay opaque — content is
the interface, and you cannot read through it. If a surface owns what is
behind it, it is not glass.

**Two shapes, and only two.** The **island** — a floating capsule at the
top of a screen, 24pt corners, `Spacing.two` below the safe-area inset,
`Spacing.three - 4` in from both edges. And the **chip** — a 40pt circle
over a photograph. The island pairs with the system tab pill below it:
two glass objects framing a feed that scrolls under both.

**The island owns its height; the screen owns its padding — and there
is ONE spelling of that padding.** It reports its rendered height and
the screen pads its scroll content with `useIslandInset(height)`, which
is `insets.top + height + IslandBreath` and nothing else. Mount it as a
**direct child of the screen surface**, never inside a `SafeAreaView`:
Yoga anchors an absolute child to the border box, so a SafeAreaView
parent's padding is invisible to the island and the two origins
disagree by exactly the notch. (Wrapped in a plain `View` the
positioning context collapses and the island renders nowhere.) There
were three spellings of this measurement once and changing the geometry
drifted two of them; `topOffset` survives only for a parent that
genuinely already sits below the notch.

**An island either stands or arrives** (#300, direction B). Saved,
Nearby and Quiz **stand**: the title is the screen's own, present from
the first frame. The story screen and the History tab **arrive** — the
hero runs full-bleed, and once its title has cleared the top edge the
glass carries it on, taking the back chip aboard on the story screen
and leaving the chevron off on the tab, where the tab pill is already
the navigation. Arrival is a **threshold, not a fade**: animating
opacity over a `GlassView` disables the glass.

**The gate on arrival is the hero, and only the hero.** Never the
content the chrome would carry: gating History's island on whether a
retelling existed meant an area Wikipedia never wrote up scrolled
forever with no chrome and no title — not late, never. And where there
is no hero, the title stands on the page instead, so a located reader
is never shown a screen that fails to say where they are.

**A standing island stands DOWN when the app is asking.** The quiz's
start card and results are surfaces you browse and wear the island; a
question is not a surface, so the chrome leaves and the question owns
the screen. That is the one sanctioned exception, and it was a device
finding before it was a rule: a `largeTitle` above a question and four
options pushed the run into a scroll.

**One professional row.** Chevron · title · count · `⋯`, with the
reading bar along its base. Not two decks of navigation. An info-only
island passes touches through, so a reader can scroll by dragging across
it; only an island holding controls intercepts.

**The line under an island title is the screen's STATUS line**, and the
count is its default: Nearby's `62 stories within a walk`, Quiz's rank
on this ground, History's counter — which is honest about where in the
screen the reader is, counting parts while they are in the telling and
relics once they reach the ground.

**One progress idiom.** A 4pt `accent`-on-`accentSoft` bar, wherever
progress is drawn — the reading bar along the island's base, and the
quiz run's own. It has one home per screen; there is no second
rendering of the same fact.

**Glass replaces the native header — never joins it.** A screen wearing
glass sets `headerShown: false`. And every state of that screen —
loading, failed, not-found — keeps its floating back chip: a screen a
reader cannot leave is a trap, whatever else failed.

**The material follows what it sits ON, not what it is.** This is the
whole rule, and it was learned twice. An **island sits over text**, so
its glass follows the app's colour scheme and its content is
theme-coloured. A **chip sits over a photograph**, so its glass **pins
dark** — real liquid glass adapts to its backdrop, and over a bright sky
it turned light beneath hard-white glyphs. Pinning alone is not enough,
because glass transmits: the chip also inks its own `tintColor`, so it
stays dark over any backdrop while still reading as glass. Glyphs follow
the same split — theme ink on an island, white on a photo chip. One
control, two renderings; pass the tint, don't fork the component.

**No glass means a scrim, and the scrim is not the same everywhere.**
`isLiquidGlassAvailable()` is false on Android, on iOS before 26, in
jest, and in every binary built before the module joined. There, the
island falls back to scheme-tinted **translucency** — never an opaque
slab, which reads as a card sitting beside the real thing — plus a
hairline and a soft shadow, since real glass draws its own. The chip
falls back to a **fixed dark scrim with white glyphs whatever the
scheme**, deeper than the journal tick's: a lone white glyph on a 40pt
chip drowns where a whole white label survives. Every fallback carries
`elevation` as well as a shadow — Android draws no shadow without it,
and a chip over a pale photograph was left holding nothing but a
hairline there.

**Every one of those materials comes from the `Glass` token group in
`theme.ts` and nowhere else.** It is sanctioned material rather than
palette, and the reason is written above it: a translucent material has
to be specified as one, and the photo scrim deliberately ignores the
theme instead of following it. Two materials — `Glass.photo` and
`Glass.page` — one base grey each, and the alpha pairs that differ
differ for a reason a comment gives. Three surfaces once carried three
greys because three people wrote them.

**Glass ships in a binary, never an OTA.** It is a native module. An
`eas update` carrying a new glass surface reaches phones whose binary
cannot draw it, and they get the scrim silently — which is why the
fallback must be good enough to ship as the only thing some users ever
see. Design at the fallback first; the real material is the upgrade.

**The tab bar is the system's own glass, and we do not draw it.**
`NativeTabs` with `minimizeBehavior="onScrollDown"`. Lists still pad
their bottom by the safe-area inset.

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
