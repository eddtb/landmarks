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
