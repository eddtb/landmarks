import * as Linking from 'expo-linking';

import NearestStory, { NearestStoryProps } from '@/widgets/nearest-story';
import { HistoryItem } from '@/types/history';
import { formatDistance, storyHook } from '@/utils/format';

/**
 * What the Home Screen widget is told. The widget runs in an isolated
 * runtime with no hooks, no async work and no access to this app's
 * helpers, so everything it shows has to be computed here and pushed
 * across already flattened — including the distance string and the
 * deep link.
 *
 * Pushed as a SNAPSHOT rather than a timeline: a timeline is for
 * content whose future is known (a countdown, a scheduled event), and
 * nothing about this is predictable. The nearest story changes when
 * the user walks, and the app finding out is the only reason it ever
 * changes.
 */

/** Nothing to show — an empty title is the widget's honest empty state. */
const NothingNearby: NearestStoryProps = { title: '', hook: '', distance: '', url: '' };

/**
 * The nearest thing worth walking to. Events and areas are excluded on
 * the same ground the feed excludes them: an article about a train
 * crash has no doorstep, and "Greenwich" is not somewhere you arrive.
 */
/**
 * The story's deep link, or nothing. createURL is the right call
 * rather than a hardcoded scheme — the development client answers to
 * `landmarks-dev` and would otherwise hand the widget a URL that opens
 * the release app. It reads the scheme from the Expo manifest, which
 * is not always there to read (no manifest under test), and a widget
 * that merely can't be tapped must never take the feed down with it.
 */
function storyUrl(pageId: number): string {
  try {
    return Linking.createURL(`/history/${pageId}`);
  } catch {
    return '';
  }
}

export function nearestStoryProps(items: HistoryItem[]): NearestStoryProps {
  const arrivable = items
    .filter((item) => !item.event && !item.area)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
  const nearest = arrivable[0];
  if (!nearest) {
    return NothingNearby;
  }
  const title = nearest.subject ?? nearest.title;
  const hook = storyHook(nearest.extract) ?? '';
  return {
    title,
    // The hook is dropped when it merely restates the name — on a
    // widget the title sits directly above it, exactly as on a card.
    hook: hook.toLowerCase().startsWith(title.toLowerCase()) ? '' : hook,
    distance: `${formatDistance(nearest.distanceMeters)} away`,
    url: storyUrl(nearest.pageId),
  };
}

// The last thing pushed, so a feed that re-renders without moving
// doesn't wake WidgetKit for an identical snapshot — reloads are
// rate-limited by the system and worth spending only on real news.
let lastPushed: string | null = null;

/** Tell the Home Screen what is nearest now. */
export function updateNearestWidget(items: HistoryItem[]) {
  const props = nearestStoryProps(items);
  const fingerprint = JSON.stringify(props);
  if (fingerprint === lastPushed) {
    return;
  }
  lastPushed = fingerprint;
  try {
    NearestStory.updateSnapshot(props);
  } catch (error) {
    // A widget that won't update is a stale square on the Home Screen,
    // never a reason for the app itself to fall over.
    console.warn('[widget] could not update the nearest story:', error);
  }
}

/** Tests only. */
export function resetWidgetFeedForTests() {
  lastPushed = null;
}
