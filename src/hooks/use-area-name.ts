import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { fetchArticleLight } from '@/data/article-client';
import { usePin } from '@/hooks/use-pin';
import { Coordinates } from '@/utils/geo';

/**
 * The area's name, chosen by article existence — not by whatever the
 * reverse geocoder answers first. Apple names the WARD ("Dorking
 * North" for Dorking), and a ward-named area strands the whole
 * gazetteer: article 404, retold 404, bare relics with no explanation
 * (device-triaged). Candidates in order: the name the user actually
 * SEARCHED (riding the pin), then the geocoder's district, subregion,
 * city. The first whose area article exists wins and names everything
 * — the header title, the gazetteer's asks, the relics self-filter.
 *
 * When no candidate's article exists, the first candidate still names
 * the area (an honest name with no story beats no name); when there
 * are no candidates at all (mid-sea), the name is null AND settled —
 * callers can stop waiting instead of pending forever.
 */
export type AreaName = {
  /** The cascade winner. Null while resolving — and after settling,
   * null means "nowhere has a name here", not "still resolving". */
  name: string | null;
  /** True once the cascade has finished for the current spot. */
  settled: boolean;
};

// One cascade per (bucket, searched name), module-level: both tabs'
// bodies and the Nearby header share the probes — at most ~3 light
// article asks, once per area — and MUST agree on the winner.
// Promise-valued so concurrent mounts join the in-flight run. Null
// results are not kept: a transient geocoder failure may well resolve
// on the next look.
const resolutions = new Map<string, Promise<string | null>>();

/** The resolution cache is module-level state — tests start clean. */
export function resetAreaNameCacheForTests() {
  resolutions.clear();
}

async function areaArticleExists(title: string): Promise<boolean> {
  try {
    // The cheap extract leg — cached server-side, and superseded
    // client-side by any complete cached article
    await fetchArticleLight(title);
    return true;
  } catch {
    // 404 or offline — either way this name cannot lead the screen
    return false;
  }
}

async function runCascade(
  latitude: number,
  longitude: number,
  searched: string | null
): Promise<string | null> {
  let place: Location.LocationGeocodedAddress | undefined;
  try {
    [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
  } catch {
    // No geocoder answer — the searched name may still carry it
  }
  const candidates = [
    ...new Set(
      [searched, place?.district, place?.subregion, place?.city].filter(
        (name): name is string => Boolean(name)
      )
    ),
  ];
  for (const candidate of candidates) {
    if (await areaArticleExists(candidate)) {
      return candidate;
    }
  }
  // Exhausted with names but no article anywhere: the first candidate
  // still names the area — the gazetteer says the story is missing in
  // words instead of showing bare relics
  return candidates[0] ?? null;
}

function resolveAreaName(
  latitude: number,
  longitude: number,
  searched: string | null
): Promise<string | null> {
  const key = `${latitude},${longitude}|${searched ?? ''}`;
  const inFlight = resolutions.get(key);
  if (inFlight) {
    return inFlight;
  }
  const resolution = runCascade(latitude, longitude, searched).then((name) => {
    if (name === null) {
      resolutions.delete(key);
    }
    return name;
  });
  resolutions.set(key, resolution);
  return resolution;
}

export function useAreaName(center: Coordinates): AreaName {
  const pin = usePin();
  // ~111m buckets (#205): an area NAME can't change inside one, and
  // effect deps finer than that re-resolved on every ~10m GPS tick.
  const latitude = Number(center.latitude.toFixed(3));
  const longitude = Number(center.longitude.toFixed(3));
  // The searched name travels with the pin, and counts only while the
  // center IS that pin (bucket-compared): back on GPS, the label no
  // longer describes this ground.
  const searched =
    pin?.label &&
    Number(pin.center.latitude.toFixed(3)) === latitude &&
    Number(pin.center.longitude.toFixed(3)) === longitude
      ? pin.label
      : null;

  const [area, setArea] = useState<AreaName>({ name: null, settled: false });

  useEffect(() => {
    let cancelled = false;
    void resolveAreaName(latitude, longitude, searched).then((resolved) => {
      if (!cancelled) {
        // Crossing a bucket rarely crosses an area — the same winner
        // keeps the same state, no header re-render
        setArea((prev) =>
          prev.settled && prev.name === resolved ? prev : { name: resolved, settled: true }
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, searched]);

  return area;
}
