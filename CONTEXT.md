# Venture

The history of where you stand: a phone app that finds the stories around
the user and speaks them. This is the shared language of the project — a
glossary, nothing else. Implementation lives in code and ADRs.

## The product

**Story**:
One place or happening near the user, with a title, a hook and a link to
its source article. The unit the feed lists and the story screen opens.
_Avoid_: item, card (a card is how a story is drawn), place, venue

**Nearby**:
The feed of stories within a walk of the user, nearest first.
_Avoid_: the list, the feed (ambiguous with the History feed)

**Telling**:
The ~one-minute narration of a story, written once from its source text
and spoken aloud on request.
_Avoid_: summary, narration, audio

**Retelling**:
The area's own long-form story, retold in parts from its full article.
_Avoid_: retold (the cache's name, not the thing), area story

**Gazetteer**:
The History tab's view of an area: its retelling above the stories that
stand on its ground.

**The shelf**:
The stories the user has saved. Keep-offline downloads the shelf.
_Avoid_: favourites, bookmarks, saved list

**The one door**:
The single first-run screen that explains the app and asks for location
before the system permission dialog appears.
_Avoid_: onboarding, splash (the splash is the animated icon before it)

**Area**:
A named place with its own article — a district, a town — whose
coordinates are a representative centre, not a destination to walk to.

**Event**:
A story that is ABOUT a happening — a crash, a fire, a battle. Events
live in History and never in Nearby: you cannot walk to a happening.

**Existence fact**:
What Wikidata knows about whether a story's subject still stands: a tag
("Demolished 1936", "Until 1675", "Former hospital"), an event verdict,
or an area verdict. Absent means honest silence, never a guess.
_Avoid_: verdict (alone), pastTag (the field name), metadata

## The ground

**Cell**:
One 0.05° square of the grid that divides the map. A position belongs to
exactly one cell.
_Avoid_: tile (a tile is the file, not the square), bucket (the older,
finer client cache grain), square

**Tile**:
The published file holding the pre-composed stories of one cell.
_Avoid_: cell (see above), chunk, page

**The bake**:
One complete run of the pipeline that turns the upstream sources into a
full set of tiles. A bake is rerun by hand when deemed necessary; there
is no schedule.
_Avoid_: build (a build is a native binary), pipeline run, generation

**Sweep**:
One stage of a bake that visits every page against a single upstream —
the extract sweep, the facts sweep.
_Avoid_: crawl, scrape, fetch (a fetch is one request)

**Compose**:
The older way of answering Nearby: assembling stories from live upstream
requests at the moment the user asks. Being retired in favour of tiles.
_Avoid_: the API road (the fallback route through compose), the server

## The discipline

**Fence**:
A test that fails when a written rule is broken, so the rule is enforced
by CI instead of by reading.
_Avoid_: guard, check (a check is any CI step), lint

**Sanctioned**:
A known exception to a rule, approved with its reason recorded at the
entry.

**Quarantined**:
A known violation of a rule, scheduled to be fixed, never forgiven. The
list can only shrink.

**The hollow signal**:
A check that reports success without doing its work — the fault the
August 2026 review found in ten different clothes.
_Avoid_: false positive, flaky

**Replay-only**:
The development mode in which no AI call may be made and every answer
comes from recorded caches.

**The breaker**:
The daily cap on AI calls that refuses further calls once spent, shared
across every kind of AI call.
_Avoid_: rate limit, quota, budget (the budget is the money; the breaker
is the mechanism)
