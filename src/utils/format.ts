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

// Grammar-based existence classification (isVanished/historyTag) was
// retired here after three failed refinements: past-tense prose cannot
// tell a demolished palace from a dissolved institution in a standing
// building. Existence facts now come structured from Wikidata
// (src/server/wikidata.ts) and ride items as `pastTag`.

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
  const match = clean.match(/^.*?\.(?=\s|$)/);
  const sentence = (match?.[0] ?? clean).trim();
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
