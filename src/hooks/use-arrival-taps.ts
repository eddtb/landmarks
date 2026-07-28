import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

/**
 * A tapped arrival opens the story it was about. Without this the
 * notification only raises the app — which, for a banner whose whole
 * promise is "here is what happened where you are standing", is the
 * least interesting thing it could do.
 *
 * Two arrival paths, because there are two ways to reach a banner: the
 * app was already running (the response listener), or the tap is what
 * launched it from cold, in which case the response is waiting to be
 * collected rather than delivered.
 */
export function useArrivalTaps() {
  useEffect(() => {
    let cancelled = false;

    const open = (response: Notifications.NotificationResponse | null) => {
      const pageId = response?.notification.request.content.data?.pageId;
      if (typeof pageId !== 'number' || cancelled) {
        return;
      }
      router.push({ pathname: '/history/[pageId]', params: { pageId: String(pageId) } });
    };

    // The cold-launch case: the tap happened before this listener could
    // exist, and the response has been held for whoever asks first.
    void Notifications.getLastNotificationResponseAsync().then(open);

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
}
