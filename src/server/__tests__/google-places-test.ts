import {
  applyRoutingSummaries,
  categoryFromTypes,
  passesQualityGate,
  mapGooglePlace,
  mapGooglePlaceDetails,
} from '@/server/google-places';
import { PlaceWithDistance } from '@/types/place';

const Origin = 'http://localhost:8081';
const User = { latitude: 51.5055, longitude: -0.0906 };

const googlePlace = {
  id: 'ChIJtest123',
  displayName: { text: 'Borough Market' },
  location: { latitude: 51.5055, longitude: -0.0917 },
  types: ['tourist_attraction', 'market'],
  rating: 4.6,
  formattedAddress: '8 Southwark St, London SE1 1TL',
  websiteUri: 'https://boroughmarket.org.uk',
  currentOpeningHours: { openNow: true },
  regularOpeningHours: {
    weekdayDescriptions: ['Monday: 10:00 AM – 5:00 PM', 'Tuesday: 10:00 AM – 5:00 PM'],
  },
  photos: [
    { name: 'places/ChIJtest123/photos/one' },
    { name: 'places/ChIJtest123/photos/two' },
  ],
  editorialSummary: { text: 'Historic food market with artisan stalls.' },
  userRatingCount: 68411,
  nationalPhoneNumber: '020 7407 1002',
  googleMapsUri: 'https://maps.google.com/?cid=123',
  priceLevel: 'PRICE_LEVEL_MODERATE',
  reviewSummary: { text: { text: 'People say this market has excellent cheese.' } },
  currentSecondaryOpeningHours: [
    {
      secondaryHoursType: 'DELIVERY',
      openNow: false,
      weekdayDescriptions: ['Monday: Closed'],
    },
    {
      secondaryHoursType: 'KITCHEN',
      openNow: true,
      weekdayDescriptions: ['Monday: 12:00 – 9:00 PM'],
    },
  ],
  reviews: [
    {
      rating: 5,
      text: { text: 'Wonderful market, great cheese.' },
      authorAttribution: { displayName: 'Ada L.' },
      relativePublishTimeDescription: '2 months ago',
    },
    {
      rating: 4,
      text: { text: '' }, // empty text — must be dropped
      authorAttribution: { displayName: 'Ghost' },
    },
  ],
};

describe('mapGooglePlace (lean list mapping)', () => {
  test('maps the card fields and computes distance', () => {
    const place = mapGooglePlace(googlePlace, 'restaurant', Origin, User);

    expect(place).toMatchObject({
      id: 'ChIJtest123',
      name: 'Borough Market',
      category: 'restaurant',
      rating: 4.6,
      ratingCount: 68411,
    });
    expect(place?.distanceMeters).toBeGreaterThan(0);
    expect(place?.distanceMeters).toBeLessThan(200);
  });

  test('routes photos through our proxy, never Google directly', () => {
    const place = mapGooglePlace(googlePlace, 'restaurant', Origin, User);

    expect(place?.photoUrl).toBe(
      `${Origin}/api/photo?name=${encodeURIComponent('places/ChIJtest123/photos/one')}`
    );
    expect(place?.photoUrl).not.toContain('googleapis.com');
  });

  test('falls back to street-view imagery when there is no photo', () => {
    const place = mapGooglePlace({ ...googlePlace, photos: undefined }, 'restaurant', Origin, User);
    expect(place?.photoUrl).toBe(`${Origin}/api/streetview?lat=51.5055&lng=-0.0917`);
  });

  test('returns null for places missing name or location', () => {
    expect(mapGooglePlace({ id: 'x' }, 'pub', Origin, User)).toBeNull();
    expect(
      mapGooglePlace({ id: 'x', displayName: { text: 'No location' } }, 'pub', Origin, User)
    ).toBeNull();
  });
});

describe('mapGooglePlaceDetails (rich detail mapping)', () => {
  test('maps every detail field', () => {
    const details = mapGooglePlaceDetails(googlePlace, Origin);

    expect(details).toMatchObject({
      id: 'ChIJtest123',
      name: 'Borough Market',
      category: 'landmark', // tourist_attraction wins
      address: '8 Southwark St, London SE1 1TL',
      hours: 'Open now',
      weekdayHours: ['Monday: 10:00 AM – 5:00 PM', 'Tuesday: 10:00 AM – 5:00 PM'],
      website: 'https://boroughmarket.org.uk',
      description: 'Historic food market with artisan stalls.',
      phone: '020 7407 1002',
      mapsUri: 'https://maps.google.com/?cid=123',
      priceLevel: '££',
      reviewSummary: 'People say this market has excellent cheese.',
      kitchenOpenNow: true,
      kitchenWeekdayHours: ['Monday: 12:00 – 9:00 PM'],
    });
    expect(details?.photoUrls).toHaveLength(2);
    expect(details?.photoUrl).toBe(details?.photoUrls[0]);
    expect(details?.photoUrls.every((url) => url.startsWith(`${Origin}/api/photo`))).toBe(true);
  });

  test('drops non-https websites rather than passing them through', () => {
    const details = mapGooglePlaceDetails(
      { ...googlePlace, websiteUri: 'http://insecure.example' },
      Origin
    );
    expect(details?.website).toBeUndefined();
  });

  test('omits hours and price when Google has no data', () => {
    const details = mapGooglePlaceDetails(
      {
        ...googlePlace,
        currentOpeningHours: undefined,
        regularOpeningHours: undefined,
        priceLevel: undefined,
      },
      Origin
    );
    expect(details?.hours).toBeUndefined();
    expect(details?.weekdayHours).toBeUndefined();
    expect(details?.priceLevel).toBeUndefined();
  });

  test('maps reviews, dropping entries without text', () => {
    const details = mapGooglePlaceDetails(googlePlace, Origin);

    expect(details?.reviews).toHaveLength(1);
    expect(details?.reviews?.[0]).toEqual({
      author: 'Ada L.',
      rating: 5,
      text: 'Wonderful market, great cheese.',
      when: '2 months ago',
    });
  });

  test('omits reviews entirely when none survive filtering', () => {
    const details = mapGooglePlaceDetails({ ...googlePlace, reviews: [] }, Origin);
    expect(details?.reviews).toBeUndefined();
  });

  test('always provides at least a street-view fallback photo', () => {
    const details = mapGooglePlaceDetails({ ...googlePlace, photos: [] }, Origin);
    expect(details?.photoUrls).toHaveLength(1);
    expect(details?.photoUrls[0]).toContain('/api/streetview?lat=');
  });
});

describe('categoryFromTypes', () => {
  test('classifies by our section priorities', () => {
    // A snooker hall with a bar is an activity, not a pub
    expect(categoryFromTypes(['sports_complex', 'bar'])).toBe('activity');
    expect(categoryFromTypes(['pub', 'restaurant'])).toBe('pub');
    expect(categoryFromTypes(['restaurant', 'point_of_interest'])).toBe('restaurant');
    expect(categoryFromTypes(['tourist_attraction'])).toBe('landmark');
    expect(categoryFromTypes(undefined)).toBe('landmark');
  });
});

describe('applyRoutingSummaries', () => {
  const place = (id: string) =>
    ({ id, name: id, distanceMeters: 100 }) as unknown as PlaceWithDistance;

  test('zips walking data onto places by index', () => {
    const result = applyRoutingSummaries(
      [place('a'), place('b')],
      [
        { legs: [{ duration: '73s', distanceMeters: 91 }], directionsUri: 'https://maps/a' },
        { legs: [{ duration: '260s', distanceMeters: 300 }], directionsUri: 'https://maps/b' },
      ]
    );

    expect(result[0]).toMatchObject({ walkSeconds: 73, walkMeters: 91 });
    expect(result[1]).toMatchObject({
      walkSeconds: 260,
      walkMeters: 300,
      walkingDirectionsUri: 'https://maps/b',
    });
  });

  test('leaves places untouched when summaries are missing or empty', () => {
    const result = applyRoutingSummaries([place('a'), place('b')], [{}, undefined as never]);
    expect(result[0]?.walkSeconds).toBeUndefined();
    expect(result[1]?.walkSeconds).toBeUndefined();

    expect(applyRoutingSummaries([place('a')], undefined)[0]?.walkSeconds).toBeUndefined();
  });

  test('preserves nulls from failed mappings', () => {
    const result = applyRoutingSummaries([null], [{ legs: [{ duration: '10s' }] }]);
    expect(result[0]).toBeNull();
  });
});

describe('passesQualityGate', () => {
  const base = { id: 'x', userRatingCount: 10, photos: [{ name: 'places/x/photos/p' }] };

  test('operational, rated places pass', () => {
    expect(passesQualityGate(base)).toBe(true);
    expect(passesQualityGate({ ...base, businessStatus: 'OPERATIONAL' })).toBe(true);
  });

  test('possibly or actually closed places are dropped', () => {
    expect(passesQualityGate({ ...base, businessStatus: 'CLOSED_TEMPORARILY' })).toBe(false);
    expect(passesQualityGate({ ...base, businessStatus: 'CLOSED_PERMANENTLY' })).toBe(false);
  });

  test('never-rated places are dropped', () => {
    expect(passesQualityGate({ id: 'x', photos: base.photos })).toBe(false);
    expect(passesQualityGate({ id: 'x', userRatingCount: 0, photos: base.photos })).toBe(false);
  });

  test('places without a real photo are dropped', () => {
    expect(passesQualityGate({ ...base, photos: undefined })).toBe(false);
    expect(passesQualityGate({ ...base, photos: [] })).toBe(false);
  });
});
