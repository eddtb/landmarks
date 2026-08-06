import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { arrivalsHydrated, flushArrivals, setArmedRegions, setArrivalsEnabled } from '@/data/arrivals';

/**
 * The eviction notice. Arrivals is being removed — the next binary
 * drops background location entirely — but phones running THIS runtime
 * still have CoreLocation regions registered and an Always grant from
 * when the feature was live. CoreLocation keeps those registrations
 * until someone calls stop, and only the old runtime still has the
 * native modules to make that call. This module, delivered by OTA, is
 * that call.
 *
 * The task stays registered, as the disarm: a wake into a bundle with
 * no task of this name is an expo-task-manager error logged and the
 * regions left armed, while a wake whose handler IS the disarm is
 * quiet and self-cleaning. The module keeps its side-effect import
 * from the root layout so the task exists before the bundle finishes
 * evaluating; the same layout also calls disarmArrivals() from a mount
 * effect, because most phones will next launch in the foreground, not
 * from a boundary crossing.
 *
 * Deleted entirely (with src/data/arrivals.ts) in the binary that
 * drops UIBackgroundModes and the Always permission strings.
 */

export const ArrivalTaskName = 'venture-arrivals';

/**
 * Idempotent, and forgiving: called from the task handler (a headless
 * wake) and from the root layout's mount effect (a foreground launch),
 * in whichever order iOS gets to them. A failed disarm must never
 * crash a pocketed phone — the next launch, or the next wake, simply
 * tries again.
 */
export async function disarmArrivals(): Promise<void> {
  try {
    await arrivalsHydrated;
    setArrivalsEnabled(false);
    setArmedRegions([]);
    await flushArrivals();
    if (await Location.hasStartedGeofencingAsync(ArrivalTaskName)) {
      await Location.stopGeofencingAsync(ArrivalTaskName);
    }
  } catch (error) {
    console.warn('[arrivals] disarm failed:', error);
  }
}

TaskManager.defineTask(ArrivalTaskName, async () => {
  await disarmArrivals();
});
