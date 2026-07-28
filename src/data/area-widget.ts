import { Directory, File } from 'expo-file-system';
import * as Linking from 'expo-linking';
import { widgetsDirectory } from 'expo-widgets';

import AreaStories, { AreaStoriesProps } from '@/widgets/area-stories';
import { HistoryItem } from '@/types/history';
import { formatDistance, formatWalkTimeForMeters } from '@/utils/format';

/**
 * What the Home Screen widget is told. The widget runs in an isolated
 * runtime with no hooks, no async work and no access to this app's
 * helpers, so everything it shows has to be computed here and pushed
 * across already flattened — the counted noun, the walk, the deep
 * link and a file path to the photograph.
 *
 * Pushed as a SNAPSHOT rather than a timeline: a timeline is for
 * content whose future is known (a countdown, a scheduled event), and
 * nothing about this is predictable. What is around you changes when
 * you walk, and the app finding out is the only reason it changes.
 */

/** Nothing to count — a zero count is the widget's empty state. */
const NothingNearby: AreaStoriesProps = {
  area: '',
  count: 0,
  nearest: '',
  nearestWalk: '',
  url: '',
  photo: '',
  // Only ever pushed once the app HAS a feed — the hook does not push
  // at all while one is still loading — so this cannot be mistaken for
  // "the widget has never been told anything". Echoes the feed's own
  // empty state rather than inventing a second voice for it.
  emptyNote: 'No recorded history right here.',
};

/**
 * Close enough that a walking time would be silly. The standing-on
 * banner uses the same idea at 45m; a widget naming the NEAREST thing
 * is usually within a street of it, and "1 min walk" for 30m is the
 * kind of rounding that makes an app feel like it isn't looking.
 */
const RightHereMeters = 30;

/** Past this, minutes say more than metres. */
const WalkTimeAboveMeters = 500;

/** How far away, in the words the feed already uses. */
export function widgetDistance(meters: number): string {
  if (meters <= RightHereMeters) {
    return 'right here';
  }
  if (meters < WalkTimeAboveMeters) {
    return `${formatDistance(meters)} away`;
  }
  return formatWalkTimeForMeters(meters);
}

/**
 * The feed's deep link, or nothing. A widget that counts what is
 * around you should open the list of it, not one arbitrary member.
 * createURL is the right call
 * rather than a hardcoded scheme — the development client answers to
 * `landmarks-dev` and would otherwise hand the widget a URL that opens
 * the release app. It reads the scheme from the Expo manifest, which
 * is not always there to read (no manifest under test), and a widget
 * that merely can't be tapped must never take the feed down with it.
 */
function feedUrl(): string {
  try {
    return Linking.createURL('/');
  } catch {
    return '';
  }
}

/**
 * The nearest thing worth walking to. Events and areas are excluded on
 * the same ground the feed excludes them: an article about a train
 * crash has no doorstep, and "Greenwich" is not somewhere you arrive.
 */
export function nearestStory(items: HistoryItem[]): HistoryItem | undefined {
  return items
    .filter((item) => !item.event && !item.area)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
}

/**
 * What the widget is told about where you are.
 *
 * `stories` is the feed's OWN walkable list — the same one its header
 * counts — so the widget can never disagree with the screen behind it.
 * The nearest of them supplies the photograph and the wider size's
 * second line.
 */
export function areaStoriesProps(
  stories: HistoryItem[],
  area: string | null,
  photo = ''
): AreaStoriesProps {
  if (stories.length === 0) {
    return NothingNearby;
  }
  const nearest = nearestStory(stories);
  return {
    area: area ?? '',
    count: stories.length,
    nearest: nearest ? (nearest.subject ?? nearest.title) : '',
    nearestWalk: nearest ? widgetDistance(nearest.distanceMeters) : '',
    url: feedUrl(),
    photo,
    emptyNote: '',
  };
}

const PhotoPrefix = 'nearest-';

/**
 * Put the place's photograph where the widget can read it.
 *
 * The widget runs in another process and cannot fetch anything, so the
 * picture has to be a FILE inside the shared App Group container that
 * both sides can see (`widgetsDirectory`). @expo/ui's Image reads it
 * synchronously off disk at render.
 *
 * Named per place rather than written to one fixed path: a stable
 * filename would leave WidgetKit free to reuse what it already
 * rendered, and the Home Screen would show the last place's picture
 * under the new place's name. Everything else is swept up after, so
 * the container holds exactly one photo.
 */
async function cacheHeroPhoto(pageId: number, url: string): Promise<string> {
  const directory = new Directory(widgetsDirectory);
  // The shared directory does not exist on a fresh install, and a
  // download into a missing directory fails SILENTLY: measured on the
  // simulator, the first launch wrote no file at all yet still handed
  // the widget a path to one. Every first-ever user would have had a
  // picture-less widget, and nothing would have said so.
  directory.create({ intermediates: true, idempotent: true });

  const wanted = `${PhotoPrefix}${pageId}.jpg`;
  const target = new File(directory, wanted);

  if (!target.exists) {
    await File.downloadFileAsync(url, target);
  }
  // Trust the disk, not the call: see above — the download can come
  // back clean having written nothing.
  if (!target.exists) {
    throw new Error(`No photo written for ${pageId}`);
  }

  for (const entry of directory.list()) {
    const name = entry.name;
    if (name.startsWith(PhotoPrefix) && name !== wanted) {
      try {
        entry.delete();
      } catch {
        // A photo we couldn't sweep is wasted bytes, not a failure
      }
    }
  }
  return target.uri;
}

// The last thing pushed, so a feed that re-renders without moving
// doesn't wake WidgetKit for an identical snapshot — reloads are
// rate-limited by the system and worth spending only on real news.
let lastPushed: string | null = null;

function push(props: AreaStoriesProps) {
  const fingerprint = JSON.stringify(props);
  if (fingerprint === lastPushed) {
    return;
  }
  lastPushed = fingerprint;
  try {
    AreaStories.updateSnapshot(props);
  } catch (error) {
    // A widget that won't update is a stale square on the Home Screen,
    // never a reason for the app itself to fall over.
    console.warn('[widget] could not update the area snapshot:', error);
  }
}

/**
 * Tell the Home Screen what is around the user now.
 *
 * Words first, picture second — the same shape as the feed's own
 * dressing pass, where the server answers with complete text and lets
 * the photographs catch up. A download is a network round trip, and
 * the widget should not sit on yesterday's area while it happens.
 */
export function updateAreaWidget(stories: HistoryItem[], area: string | null) {
  push(areaStoriesProps(stories, area));

  const nearest = nearestStory(stories);
  const url = nearest?.thumbnailUrl;
  if (!nearest || !url) {
    return;
  }
  void cacheHeroPhoto(nearest.pageId, url)
    .then((photo) => {
      // The ground may have moved while the download ran; only dress
      // the area that is still the one being shown.
      if (nearestStory(stories)?.pageId === nearest.pageId) {
        push(areaStoriesProps(stories, area, photo));
      }
    })
    .catch((error) => {
      // No picture is a plainer widget, not a broken one.
      console.warn('[widget] could not cache the hero photo:', error);
    });
}

/** Tests only. */
export function resetWidgetFeedForTests() {
  lastPushed = null;
}
