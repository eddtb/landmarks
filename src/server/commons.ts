/**
 * Wikimedia Commons: subject photographs. Near a landmark, Commons
 * usually holds a photo OF the thing — including photos of the exact
 * plaques — but the nearest file to a point can be a passing bus, so
 * a candidate only counts when its filename shares the story's name.
 * Coverage gaps fall through to Geograph's everywhere-grid.
 */

import { Coordinates } from '@/utils/geo';

const UserAgent = 'landmarks-app/1.0 (https://github.com/eddtb/landmarks; learning project)';

export type StoryPhoto = { imageUrl: string; credit: string };

type CommonsPage = {
  title?: string;
  imageinfo?: {
    thumburl?: string;
    extmetadata?: {
      Artist?: { value?: string };
      LicenseShortName?: { value?: string };
    };
  }[];
};

const NoiseTokens = new Set(['the', 'a', 'an', 'of', 'and', 'file', 'jpg', 'jpeg', 'png']);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !NoiseTokens.has(word))
  );
}

/**
 * Pure and unit-tested: the file whose name best matches the story's,
 * or null. Two shared name tokens required — "Greenwich" alone matches
 * half the borough's photographs.
 */
export function pickCommonsFile(storyTitle: string, pages: CommonsPage[]): CommonsPage | null {
  const storyTokens = tokens(storyTitle);
  let best: { page: CommonsPage; shared: number } | null = null;
  for (const page of pages) {
    if (!page.title || !page.imageinfo?.[0]?.thumburl) {
      continue;
    }
    const fileTokens = tokens(page.title);
    const shared = [...storyTokens].filter((token) => fileTokens.has(token)).length;
    if (shared >= 2 && (!best || shared > best.shared)) {
      best = { page, shared };
    }
  }
  return best?.page ?? null;
}

/** Artist values arrive as HTML links — the credit line wants a name. */
export function creditLine(page: CommonsPage): string {
  const meta = page.imageinfo?.[0]?.extmetadata;
  const artist = (meta?.Artist?.value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const license = meta?.LicenseShortName?.value ?? 'see Commons';
  return `Photo: ${artist || 'Wikimedia Commons'} / Commons (${license})`;
}

export async function findCommonsPhoto(
  storyTitle: string,
  coordinates: Coordinates
): Promise<StoryPhoto | null> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'geosearch',
    ggscoord: `${coordinates.latitude}|${coordinates.longitude}`,
    ggsradius: '150',
    ggslimit: '20',
    ggsnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '800',
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UserAgent },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) {
    throw new Error(`Commons query failed with status ${response.status}`);
  }
  const body = (await response.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const match = pickCommonsFile(storyTitle, Object.values(body.query?.pages ?? {}));
  if (!match) {
    return null;
  }
  return { imageUrl: match.imageinfo![0].thumburl!, credit: creditLine(match) };
}
