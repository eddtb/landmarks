/**
 * The web of history: when a retold paragraph mentions another nearby
 * story by name, the mention becomes a door. Longest titles match
 * first (the Liberty of the Clink before the Clink), word boundaries
 * only, one link per title per paragraph, and one-word titles are
 * ignored — "Greenwich" would link half the prose.
 */

export type LinkCandidate = { title: string; pageId: number };
export type TextSegment = { text: string; pageId?: number };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The story-level link plan: each title becomes a door ONCE per story,
 * at its first mention — Wikipedia's own first-occurrence convention.
 * Precomputed and pure so virtualised part rows (which can render in
 * any order after a timeline jump) all agree on where the door is.
 * Returns, per part, per paragraph, the candidates allowed to link.
 */
export function planStoryLinks(
  partParagraphs: string[][],
  candidates: LinkCandidate[]
): LinkCandidate[][][] {
  const plan = partParagraphs.map((paragraphs) => paragraphs.map(() => [] as LinkCandidate[]));
  for (const candidate of candidates) {
    if (candidate.title.trim().split(/\s+/).length < 2) {
      continue;
    }
    const pattern = new RegExp(`\\b${escapeRegExp(candidate.title)}\\b`, 'i');
    outer: for (let part = 0; part < partParagraphs.length; part++) {
      for (let index = 0; index < partParagraphs[part].length; index++) {
        if (pattern.test(partParagraphs[part][index])) {
          plan[part][index].push(candidate);
          break outer;
        }
      }
    }
  }
  return plan;
}

export function linkifyParagraph(
  paragraph: string,
  candidates: LinkCandidate[]
): TextSegment[] {
  const linkable = candidates
    .filter((candidate) => candidate.title.trim().split(/\s+/).length >= 2)
    .sort((a, b) => b.title.length - a.title.length);

  let segments: TextSegment[] = [{ text: paragraph }];
  for (const candidate of linkable) {
    const pattern = new RegExp(`\\b${escapeRegExp(candidate.title)}\\b`, 'i');
    let linked = false;
    segments = segments.flatMap((segment) => {
      if (segment.pageId !== undefined || linked) {
        return [segment];
      }
      const match = segment.text.match(pattern);
      if (!match || match.index === undefined) {
        return [segment];
      }
      linked = true;
      const before = segment.text.slice(0, match.index);
      const after = segment.text.slice(match.index + match[0].length);
      return [
        ...(before ? [{ text: before }] : []),
        { text: match[0], pageId: candidate.pageId },
        ...(after ? [{ text: after }] : []),
      ];
    });
  }
  return segments;
}
