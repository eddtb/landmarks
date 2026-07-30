/** 850 -> "850 m", 1240 -> "1.2 km" */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/** 73 -> "1 min walk", 260 -> "4 min walk" */
export function formatWalkTime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min walk`;
}

/** The walking pace the app quotes times at: 1.33 m/s ≈ 4.8 km/h —
 * the same figure the server's sparse horizon comment reasons with. */
export const WalkingSpeedMps = 1.33;

/** 3000 -> "38 min walk": meters at walking pace, for copy that
 * derives from a distance rather than a routed duration. */
export function formatWalkTimeForMeters(meters: number): string {
  return formatWalkTime(meters / WalkingSpeedMps);
}

// Grammar-based existence classification (isVanished/historyTag) was
// retired here after three failed refinements: past-tense prose cannot
// tell a demolished palace from a dissolved institution in a standing
// building. Existence facts now come structured from Wikidata
// (src/server/wikidata.ts) and ride items as `pastTag`.

/**
 * Markdown emphasis, flattened to its words. The retold prompt asks for
 * plain prose, but the model still italicises the occasional film or
 * ship title — and the renderer is Text, not markdown, so "*Sherlock
 * Holmes* (2009)" reached the screen with its asterisks on (caught on
 * the simulator, Royal Naval College part eight). Display-time so the
 * 30-day cached retellings are fixed too.
 */
export function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\s][^*]*)\*/g, '$1');
}

/** "https://en.wikipedia.org/wiki/Cutty_Sark" → "Cutty Sark", or null. */
export function wikiTitleFromUrl(url: string): string | null {
  const match = url.match(/wikipedia\.org\/wiki\/([^#?]+)/);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]).replace(/_/g, ' ');
  } catch {
    return null;
  }
}

/**
 * Wikipedia intro extracts arrive as one block: paragraphs separated by
 * bare newlines, sometimes opening with a pronunciation parenthetical —
 * "Cutty Sark (/ˌkʌti ˈsɑːrk/) is…" — that reads as clutter on screen
 * and worse out loud. Split, strip, trim.
 */
export function storyParagraphs(extract: string): string[] {
  return extract
    .replace(/\s*\((?:[^)]*\/){2}[^)]*\)/g, '') // parentheticals with /IPA/ inside
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

// A full stop after these is an abbreviation, not a sentence end —
// "St. Paul's" must not truncate the hook to "St."
const AbbreviationBeforeDot = /(?:^|[\s(])(?:St|Dr|Mr|Mrs|No|c)$/;

/** The first sentence of `text`, or all of it when no boundary earns
 * the name (an abbreviation's dot never does). */
function firstSentence(text: string): string {
  const boundaries = text.matchAll(/\.(?=\s|$)/g);
  for (const boundary of boundaries) {
    if (!AbbreviationBeforeDot.test(text.slice(0, boundary.index))) {
      return text.slice(0, boundary.index + 1);
    }
  }
  return text;
}

/**
 * The history card's hook: the extract's first sentence, because
 * "a nuclear reactor ran here until 1996" is the reason to tap and
 * the title alone never says it. Capped so a rambling opening
 * sentence can't swallow the card.
 */
export function storyHook(extract: string | undefined): string | undefined {
  if (!extract) {
    return undefined;
  }
  const clean = storyParagraphs(extract)[0] ?? '';
  const sentence = firstSentence(clean).trim();
  if (sentence.length <= 160) {
    return sentence;
  }
  return `${sentence.slice(0, 157).trimEnd()}…`;
}

/**
 * A plaque's card title IS its inscription's opening, so the hook —
 * the extract's first sentence — often just repeats the headline with
 * three more words. A card that says the same thing twice reads as
 * broken (Edd's "empty Open Plaque listings"). Echo = one is a
 * truncation-tolerant prefix of the other.
 */
export function hookEchoesTitle(title: string, hook: string): boolean {
  const strip = (text: string) => text.replace(/…$/, '').trim().toLowerCase();
  const a = strip(title);
  const b = strip(hook);
  if (!a || !b) {
    return false;
  }
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * When the journal did something, in card words: "today", "yesterday",
 * a weekday inside the week ("Tuesday"), then dates ("12 July"). The
 * card meta line speaks in days, not timestamps — "Visited Tuesday"
 * is how a person says it.
 */
export function formatDaySince(at: number, now = Date.now()): string {
  const day = (ms: number) => {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const daysAgo = Math.round((day(now) - day(at)) / (24 * 60 * 60 * 1000));
  if (daysAgo <= 0) {
    return 'today';
  }
  if (daysAgo === 1) {
    return 'yesterday';
  }
  const date = new Date(at);
  if (daysAgo < 7) {
    return date.toLocaleDateString('en-GB', { weekday: 'long' });
  }
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}
