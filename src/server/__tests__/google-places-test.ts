import { mapGooglePlace } from '@/server/google-places';

const Origin = 'http://localhost:8081';
const User = { latitude: 51.5055, longitude: -0.0906 };

const fullGooglePlace = {
  id: 'ChIJtest123',
  displayName: { text: 'Borough Market' },
  location: { latitude: 51.5055, longitude: -0.0917 },
  rating: 4.6,
  formattedAddress: '8 Southwark St, London SE1 1TL',
  websiteUri: 'https://boroughmarket.org.uk',
  currentOpeningHours: { openNow: true },
  photos: [{ name: 'places/ChIJtest123/photos/photoref' }],
  editorialSummary: { text: 'Historic food market with artisan stalls.' },
  userRatingCount: 68411,
  nationalPhoneNumber: '020 7407 1002',
};

describe('mapGooglePlace', () => {
  test('maps a full Google place to our shape', () => {
    const place = mapGooglePlace(fullGooglePlace, 'restaurant', Origin, User);

    expect(place).toMatchObject({
      id: 'ChIJtest123',
      name: 'Borough Market',
      category: 'restaurant',
      rating: 4.6,
      address: '8 Southwark St, London SE1 1TL',
      website: 'https://boroughmarket.org.uk',
      hours: 'Open now',
      description: 'Historic food market with artisan stalls.',
      ratingCount: 68411,
      phone: '020 7407 1002',
    });
    expect(place?.distanceMeters).toBeGreaterThan(0);
    expect(place?.distanceMeters).toBeLessThan(200);
  });

  test('routes photos through our proxy, never Google directly', () => {
    const place = mapGooglePlace(fullGooglePlace, 'restaurant', Origin, User);

    expect(place?.photoUrl).toBe(
      `${Origin}/api/photo?name=${encodeURIComponent('places/ChIJtest123/photos/photoref')}`
    );
    expect(place?.photoUrl).not.toContain('googleapis.com');
  });

  test('falls back to a placeholder image when there is no photo', () => {
    const place = mapGooglePlace(
      { ...fullGooglePlace, photos: undefined },
      'restaurant',
      Origin,
      User
    );
    expect(place?.photoUrl).toContain('picsum.photos');
  });

  test('drops non-https websites rather than passing them through', () => {
    const place = mapGooglePlace(
      { ...fullGooglePlace, websiteUri: 'http://insecure.example' },
      'restaurant',
      Origin,
      User
    );
    expect(place?.website).toBeUndefined();
  });

  test('omits hours when Google has no opening data', () => {
    const place = mapGooglePlace(
      { ...fullGooglePlace, currentOpeningHours: undefined },
      'restaurant',
      Origin,
      User
    );
    expect(place?.hours).toBeUndefined();
  });

  test('omits phone when Google has no number on file', () => {
    const place = mapGooglePlace(
      { ...fullGooglePlace, nationalPhoneNumber: undefined },
      'restaurant',
      Origin,
      User
    );
    expect(place?.phone).toBeUndefined();
  });

  test('returns null for places missing name or location', () => {
    expect(mapGooglePlace({ id: 'x' }, 'pub', Origin, User)).toBeNull();
    expect(
      mapGooglePlace({ id: 'x', displayName: { text: 'No location' } }, 'pub', Origin, User)
    ).toBeNull();
  });
});
