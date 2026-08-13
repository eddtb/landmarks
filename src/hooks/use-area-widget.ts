import { useEffect } from 'react';
import { Platform } from 'react-native';

import { updateAreaWidget } from '@/data/area-widget';
import { HistoryItem } from '@/types/history';

/**
 * Keep the Home Screen widget in step with the feed. Unlike arrivals
 * this needs no opt-in — nothing leaves the device and nothing runs in
 * the background; the widget only ever shows what the app already
 * fetched while the user had it open.
 *
 * Guarded to real position: while exploring a pinned centre, the count
 * would be about somewhere the user is nowhere near, and a Home Screen
 * that quietly lies is worse than one that stays as it was.
 *
 * The same guard covers a feed still loading — callers pass live=false
 * until it is ready. An empty list pushed mid-load would reach the
 * widget as "No recorded history right here", which is a different
 * untruth from the one it replaces; saying nothing leaves the last
 * area on screen, which is the honest thing to show while looking.
 */
export function useAreaWidget(stories: HistoryItem[], area: string | null, live: boolean) {
  useEffect(() => {
    // The widget target is iOS-only here — the plugin's Android half
    // is left off, so there is nothing on the other side to tell.
    if (!live || Platform.OS !== 'ios') {
      return;
    }
    updateAreaWidget(stories, area);
  }, [stories, area, live]);
}
