import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import {
  ArrivalRadiusMeters,
  ArrivalRegion,
  armedRegion,
  armedRegions,
  arrivalsEnabled,
  arrivalsHydrated,
  flushArrivals,
  inQuietPeriod,
  markAnnounced,
  recentlyAnnounced,
  sameArmedSet,
  selectArrivalRegions,
  setArmedRegions,
  setArrivalsEnabled,
} from '@/data/arrivals';
import { HistoryItem } from '@/types/history';
import { hookEchoesTitle } from '@/utils/format';

/**
 * The native half of arrivals: the CoreLocation regions, the task iOS
 * wakes us into, and the notification it produces.
 *
 * The task is defined at module scope on purpose, and this module is
 * imported from the root layout for that reason alone. When iOS
 * decides the user has crossed a boundary it launches the app into the
 * background and expects the task to already be registered by the time
 * the bundle finishes evaluating — a task registered inside a
 * component effect does not exist yet at that moment, and the wake is
 * silently wasted. Nothing here may assume a React tree, a network, or
 * anything held in memory by a previous run.
 *
 * See src/data/arrivals.ts for the twenty-region ceiling and why the
 * armed table lives on disk.
 */

export const ArrivalTaskName = 'venture-arrivals';
const AndroidChannelId = 'arrivals';

/**
 * Foreground arrivals are worth showing too — someone walking with the
 * feed open is exactly who this is for, and the OS suppresses banners
 * for a foregrounded app unless told otherwise.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Enough new words past the title to be worth reading. Below it, a
 * hook is the title again with a date stuck on the end — the plaque
 * case, where the card title IS the inscription's opening words.
 */
const MinHookGainChars = 24;

/**
 * The feed card suppresses any hook that merely starts with the title
 * (hookEchoesTitle), which on Wikipedia is nearly all of them — "The
 * Marshalsea was a debtors' prison…" opens with its own name. On a
 * card that is right, because the title is sitting directly above it.
 *
 * A banner cannot afford the same rule. The body is the whole reason
 * to look up from the pavement, and dropping it leaves the
 * notification saying nothing at all. So the echo test only bites here
 * when the hook adds no real words to the title.
 */
function hookAddsNothing(title: string, hook: string): boolean {
  return hookEchoesTitle(title, hook) && hook.length - title.length < MinHookGainChars;
}

/**
 * What the banner says. The title names the place; the body gives the
 * reason to look up.
 */
export function arrivalNotificationText(region: ArrivalRegion): {
  title: string;
  body: string;
} {
  const hook = region.hook?.trim();
  if (hook && !hookAddsNothing(region.title, hook)) {
    return { title: region.title, body: hook };
  }
  return { title: region.title, body: "You're standing right here." };
}

/**
 * The wake. Runs cold: the store is read from disk before anything is
 * decided, and the "already said" mark is flushed before returning,
 * because iOS may kill this runtime the instant it does.
 */
TaskManager.defineTask<{
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}>(ArrivalTaskName, async ({ data, error }) => {
  if (error) {
    console.warn('[arrivals] geofence task error:', error);
    return;
  }
  if (!data || data.eventType !== Location.GeofencingEventType.Enter) {
    return;
  }
  try {
    await arrivalsHydrated;
    // The user may have opted out since the regions were armed; iOS
    // can still deliver one crossing from the old set.
    if (!arrivalsEnabled()) {
      return;
    }
    const pageId = Number(data.region.identifier);
    if (!Number.isFinite(pageId)) {
      return;
    }
    const region = armedRegion(pageId);
    if (!region || recentlyAnnounced(pageId)) {
      return;
    }
    // Something else just spoke. Dense ground delivers many crossings
    // in the same instant and one arrival should be one banner. The
    // skipped place is not marked — it simply didn't get this turn.
    //
    // Claim the turn SYNCHRONOUSLY. iOS delivers these wakes
    // concurrently: measured on the simulator, arriving in
    // Westminster fired nineteen of them inside 127ms, and with the
    // mark written after the notification await, all nineteen passed
    // the quiet check before any of them had set it. JS is
    // single-threaded, so a check and a set with no await between
    // them cannot interleave — the claim has to happen here, not
    // after the banner is scheduled.
    if (inQuietPeriod()) {
      return;
    }
    markAnnounced(pageId);

    const { title, body } = arrivalNotificationText(region);
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        // The tap target: the story screen for this place.
        data: { pageId },
        ...(Platform.OS === 'android' ? { channelId: AndroidChannelId } : null),
      },
      trigger: null,
    });
    await flushArrivals();
  } catch (taskError) {
    // A failed wake is a missed greeting, never a crash on a user's
    // phone in their pocket.
    console.warn('[arrivals] geofence task failed:', taskError);
  }
});

/** Android 13+ refuses the permission prompt without a channel. */
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') {
    return;
  }
  await Notifications.setNotificationChannelAsync(AndroidChannelId, {
    name: 'Arrivals',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Everything arrivals need before they can be armed: notifications to
 * speak with, and background location to be woken by. Returns what
 * actually happened rather than throwing — a refused permission is an
 * answer the UI has to show, not an error.
 */
export async function requestArrivalPermissions(): Promise<
  'granted' | 'denied-notifications' | 'denied-location'
> {
  await ensureAndroidChannel();
  const notifications = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: false },
  });
  if (!notifications.granted) {
    return 'denied-notifications';
  }
  // Background location cannot be asked for before foreground has been
  // granted — iOS returns denied outright if it is.
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    return 'denied-location';
  }
  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) {
    return 'denied-location';
  }
  return 'granted';
}

function toLocationRegions(regions: ArrivalRegion[]): Location.LocationRegion[] {
  return regions.map((region) => ({
    identifier: String(region.pageId),
    latitude: region.coordinates.latitude,
    longitude: region.coordinates.longitude,
    radius: ArrivalRadiusMeters,
    notifyOnEnter: true,
    // Leaving is not an event this app has anything to say about, and
    // every exit we ask for is a background wake spent on nothing.
    notifyOnExit: false,
  }));
}

/**
 * Bring the monitored set in step with where the user is. Called as
 * the feed moves; a no-op when the chosen twenty haven't changed,
 * because re-arming resets region state in CoreLocation and can drop a
 * crossing already in progress.
 */
export async function syncArrivalRegions(
  nearby: HistoryItem[],
  saved: HistoryItem[]
): Promise<void> {
  await arrivalsHydrated;
  if (!arrivalsEnabled()) {
    return;
  }
  const next = selectArrivalRegions(nearby, saved);
  if (next.length === 0) {
    return;
  }
  if (sameArmedSet(armedRegions(), next)) {
    return;
  }
  try {
    // Write the table BEFORE arming: a crossing can be delivered the
    // moment the regions land, and a task that wakes to a table it
    // cannot find its region in has no name to announce.
    setArmedRegions(next);
    await flushArrivals();
    await Location.startGeofencingAsync(ArrivalTaskName, toLocationRegions(next));
  } catch (error) {
    console.warn('[arrivals] could not arm regions:', error);
  }
}

/**
 * The toggle's ON side: ask, then remember. Arming is deliberately NOT
 * done here — the feed owns it (useArrivalsSync), because the feed is
 * what knows where the user is, and a second arming path would be a
 * second thing to keep in step with the ceiling. Flipping the flag is
 * what makes the feed's effect run.
 */
export async function enableArrivals(): Promise<
  'granted' | 'denied-notifications' | 'denied-location'
> {
  const outcome = await requestArrivalPermissions();
  if (outcome !== 'granted') {
    return outcome;
  }
  await arrivalsHydrated;
  setArrivalsEnabled(true);
  return 'granted';
}

/** The OFF side: stop being woken, and forget what was armed. */
export async function disableArrivals(): Promise<void> {
  await arrivalsHydrated;
  setArrivalsEnabled(false);
  await flushArrivals();
  try {
    if (await Location.hasStartedGeofencingAsync(ArrivalTaskName)) {
      await Location.stopGeofencingAsync(ArrivalTaskName);
    }
  } catch (error) {
    console.warn('[arrivals] could not stop geofencing:', error);
  }
}
