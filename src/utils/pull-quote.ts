/**
 * A pull-quote must not read as a repeat (Edd's ruling): the model
 * copies the sentence verbatim from the body — that's the trust
 * contract — so at RENDER time the body gives the sentence up. The
 * highlight replaces its origin instead of echoing it.
 *
 * Matching is cosmetics-tolerant, same as the parser's validator:
 * curly quotes, commas and case may drift; the words may not.
 */

const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function withoutPullQuote(paragraphs: string[], pullQuote?: string): string[] {
  if (!pullQuote) {
    return paragraphs;
  }
  const target = squash(pullQuote);
  if (!target) {
    return paragraphs;
  }
  let removed = false;
  return paragraphs
    .map((paragraph) => {
      if (removed) {
        return paragraph;
      }
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      const index = sentences.findIndex((sentence) => squash(sentence) === target);
      if (index < 0) {
        return paragraph;
      }
      removed = true;
      return sentences.filter((_, i) => i !== index).join(' ');
    })
    .filter((paragraph) => paragraph.trim().length > 0);
}
