import { WalkingRoute } from '@/types/route';
import { Coordinates } from '@/utils/geo';

/** Server-side only — the key never leaves this process. */

const RoutesEndpoint = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// Routes API requires an explicit field mask; billed by what you request
const RouteFieldMask = [
  'routes.duration',
  'routes.distanceMeters',
  'routes.legs.steps.navigationInstruction.instructions',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.startLocation.latLng',
  'routes.legs.steps.endLocation.latLng',
].join(',');

type LatLng = { latitude?: number; longitude?: number };

type RoutesResponse = {
  routes?: {
    duration?: string;
    distanceMeters?: number;
    legs?: {
      steps?: {
        distanceMeters?: number;
        navigationInstruction?: { instructions?: string };
        startLocation?: { latLng?: LatLng };
        endLocation?: { latLng?: LatLng };
      }[];
    }[];
  }[];
};

function asCoordinates(latLng: LatLng | undefined): Coordinates | undefined {
  if (latLng?.latitude === undefined || latLng.longitude === undefined) {
    return undefined;
  }
  return { latitude: latLng.latitude, longitude: latLng.longitude };
}

/** Pure mapping step, unit-testable without network. */
export function mapWalkingRoute(body: RoutesResponse): WalkingRoute | null {
  const route = body.routes?.[0];
  if (!route) {
    return null;
  }

  const steps = (route.legs ?? [])
    .flatMap((leg) => leg.steps ?? [])
    .filter((step) => !!step.navigationInstruction?.instructions)
    .map((step) => ({
      instruction: step.navigationInstruction!.instructions!,
      meters: step.distanceMeters ?? 0,
      start: asCoordinates(step.startLocation?.latLng),
      end: asCoordinates(step.endLocation?.latLng),
    }));

  const seconds = Number((route.duration ?? '').replace(/s$/, ''));

  return {
    seconds: Number.isFinite(seconds) ? seconds : 0,
    meters: route.distanceMeters ?? 0,
    steps,
  };
}

export async function computeWalkingRoute(
  apiKey: string,
  from: Coordinates,
  to: Coordinates
): Promise<WalkingRoute | null> {
  const response = await fetch(RoutesEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': RouteFieldMask,
    },
    body: JSON.stringify({
      origin: { location: { latLng: from } },
      destination: { location: { latLng: to } },
      travelMode: 'WALK',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Routes API ${response.status}: ${detail.slice(0, 500)}`);
  }

  return mapWalkingRoute((await response.json()) as RoutesResponse);
}
