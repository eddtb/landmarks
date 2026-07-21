import { Coordinates } from '@/utils/geo';

export type RouteCamera = {
  coordinates: Coordinates;
  zoom: number;
};

/**
 * expo-maps takes a center + zoom rather than bounds, so we compute the
 * camera that frames a set of points ourselves: center on the bounding
 * box, then pick the zoom whose visible span covers the padded box.
 * Zoom is web-mercator style: the world is 256·2^zoom pixels wide.
 */
const AssumedViewWidthPixels = 375;
const TileSizePixels = 256;
/** Breathing room so the route never touches the map edges. */
const PaddingFactor = 1.4;
/** ≈330 m — keeps a one-block hop from zooming in absurdly close. */
const MinSpanDegrees = 0.003;
const MinZoom = 12;
const MaxZoom = 17;

export function cameraForRoute(points: Coordinates[]): RouteCamera | null {
  if (points.length === 0) {
    return null;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const center = {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
  };

  const latSpan = Math.max(...latitudes) - Math.min(...latitudes);
  // Longitude degrees shrink with latitude — normalize to latitude-sized ones
  const lngSpan =
    (Math.max(...longitudes) - Math.min(...longitudes)) *
    Math.cos((center.latitude * Math.PI) / 180);
  const span = Math.max(latSpan, lngSpan, MinSpanDegrees) * PaddingFactor;

  const zoom = Math.log2((360 * AssumedViewWidthPixels) / (TileSizePixels * span));
  return { coordinates: center, zoom: Math.min(MaxZoom, Math.max(MinZoom, zoom)) };
}
