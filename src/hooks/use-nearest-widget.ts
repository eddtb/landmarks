import { useEffect } from 'react';
import { Platform } from 'react-native';

import { updateNearestWidget } from '@/data/widget-feed';
import { HistoryItem } from '@/types/history';

/**
 * Keep the Home Screen widget in step with the feed. Unlike arrivals
 * this needs no opt-in — nothing leaves the device and nothing runs in
 * the background; the widget only ever shows what the app already
 * fetched while the user had it open.
 *
 * Guarded to real position: while exploring a pinned centre, "nearest"
 * would name somewhere the user is nowhere near, and a Home Screen
 * that quietly lies is worse than one that stays as it was.
 */
export function useNearestWidget(items: HistoryItem[], live: boolean) {
  useEffect(() => {
    // The widget target is iOS-only here — the plugin's Android half
    // is left off, so there is nothing on the other side to tell.
    if (!live || Platform.OS !== 'ios') {
      return;
    }
    updateNearestWidget(items);
  }, [items, live]);
}
