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

/**
 * The camera for a FIELD OF PINS in a card, rather than a route in one.
 *
 * Two things cameraForRoute gets away with and this cannot, both caught
 * in a simulator screenshot of twelve pins in a 220pt strip: the card is
 * far wider than it is tall, and cameraForRoute derives zoom from width
 * alone — so the northernmost pin was clipped clean off the top edge.
 * And a marker draws a ~35pt glyph ABOVE its coordinate, so framing the
 * coordinates exactly still buries the top row under the card's rim.
 *
 * So: fit both axes, take the tighter zoom (in a strip it is the height
 * that binds), and reserve the glyph in real pixels rather than by a
 * multiplicative fudge factor.
 */
export function cameraForPins(options: {
  points: Coordinates[];
  widthPixels: number;
  heightPixels: number;
  /** Room for the marker glyph the coordinate sits beneath. */
  glyphPixels?: number;
}): RouteCamera | null {
  const { points, widthPixels, heightPixels, glyphPixels = 40 } = options;
  if (points.length === 0) {
    return null;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const center = {
    latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
  };

  const latSpan = Math.max(Math.max(...latitudes) - Math.min(...latitudes), MinSpanDegrees);
  // Longitude degrees shrink with latitude — normalize to latitude-sized ones
  const lngSpan = Math.max(
    (Math.max(...longitudes) - Math.min(...longitudes)) *
      Math.cos((center.latitude * Math.PI) / 180),
    MinSpanDegrees
  );

  // A glyph's worth at each edge, so a pin on the boundary still draws
  // inside the card
  const usableWidth = Math.max(1, widthPixels - glyphPixels * 2);
  const usableHeight = Math.max(1, heightPixels - glyphPixels * 2);
  const zoomForWidth = Math.log2((360 * usableWidth) / (TileSizePixels * lngSpan));
  const zoomForHeight = Math.log2((360 * usableHeight) / (TileSizePixels * latSpan));

  const zoom = Math.min(zoomForWidth, zoomForHeight);
  return { coordinates: center, zoom: Math.min(MaxZoom, Math.max(MinZoom, zoom)) };
}

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
