import { Place, PlaceCategory, PlaceWithDistance } from '@/types/place';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * Placeholder data so the UI can be built and tested before the Google Places
 * API route exists. Coordinates are real; the list is replaced in the
 * "real data" milestone.
 */
export const MockPlaces: Place[] = [
  {
    id: 'tower-bridge',
    name: 'Tower Bridge',
    category: 'landmark',
    coordinates: { latitude: 51.5055, longitude: -0.0754 },
    rating: 4.8,
    photoUrl: 'https://picsum.photos/seed/tower-bridge/800/500',
    address: 'Tower Bridge Rd, London SE1 2UP',
    hours: 'Open 09:30 – 18:00',
    website: 'https://www.towerbridge.org.uk',
    story:
      'Tower Bridge is a combined bascule and suspension bridge, built between 1886 and 1894 to ease road traffic while maintaining river access to the busy Pool of London docks. Its twin Gothic towers and blue suspension chains have made it one of the most recognisable bridges in the world, often mistaken by visitors for its plainer upstream neighbour, London Bridge.',
  },
  {
    id: 'st-pauls-cathedral',
    name: "St Paul's Cathedral",
    category: 'landmark',
    coordinates: { latitude: 51.5138, longitude: -0.0984 },
    rating: 4.7,
    photoUrl: 'https://picsum.photos/seed/st-pauls/800/500',
    address: "St Paul's Churchyard, London EC4M 8AD",
    hours: 'Open 08:30 – 16:30',
    website: 'https://www.stpauls.co.uk',
    story:
      "St Paul's Cathedral, designed by Sir Christopher Wren, was completed in 1710 after the Great Fire of London destroyed its medieval predecessor. Its dome dominated the London skyline for over 250 years, and the cathedral famously survived the Blitz, becoming a symbol of national resilience.",
  },
  {
    id: 'tate-modern',
    name: 'Tate Modern',
    category: 'landmark',
    coordinates: { latitude: 51.5076, longitude: -0.0994 },
    rating: 4.6,
    photoUrl: 'https://picsum.photos/seed/tate-modern/800/500',
    address: 'Bankside, London SE1 9TG',
    hours: 'Open 10:00 – 18:00',
    website: 'https://www.tate.org.uk/visit/tate-modern',
    story:
      'Tate Modern occupies the former Bankside Power Station, a monumental brick building designed by Giles Gilbert Scott. Converted by architects Herzog & de Meuron and opened in 2000, it is among the most-visited modern art museums in the world, with its vast Turbine Hall hosting large-scale installations.',
  },
  {
    id: 'southwark-cathedral',
    name: 'Southwark Cathedral',
    category: 'landmark',
    coordinates: { latitude: 51.5061, longitude: -0.0897 },
    rating: 4.6,
    photoUrl: 'https://picsum.photos/seed/southwark-cathedral/800/500',
    address: 'London Bridge, London SE1 9DA',
    hours: 'Open 09:00 – 17:00',
    website: 'https://cathedral.southwark.anglican.org',
    story:
      'Southwark Cathedral has been a place of worship for over 1,000 years and is the oldest Gothic church building in London. William Shakespeare, whose Globe Theatre stood nearby, is commemorated inside, and his brother Edmund is buried in the churchyard.',
  },
  {
    id: 'the-shard-view',
    name: 'The View from The Shard',
    category: 'landmark',
    coordinates: { latitude: 51.5045, longitude: -0.0865 },
    rating: 4.5,
    photoUrl: 'https://picsum.photos/seed/the-shard/800/500',
    address: '32 London Bridge St, London SE1 9SG',
    hours: 'Open 10:00 – 22:00',
    website: 'https://www.theviewfromtheshard.com',
    story:
      'The Shard, designed by Renzo Piano and completed in 2012, is the tallest building in the United Kingdom at 310 metres. Its viewing gallery on floors 68–72 offers panoramic views of up to 40 miles across London on a clear day.',
  },
  {
    id: 'padella',
    name: 'Padella',
    category: 'restaurant',
    coordinates: { latitude: 51.5053, longitude: -0.0906 },
    description: 'Compact, buzzy spot serving handmade pasta at counter seats.',
    ratingCount: 12840,
    rating: 4.6,
    photoUrl: 'https://picsum.photos/seed/padella/800/500',
    address: '6 Southwark St, London SE1 1TQ',
    hours: 'Open 12:00 – 22:00',
    website: 'https://www.padella.co',
  },
  {
    id: 'monmouth-coffee',
    name: 'Monmouth Coffee Company',
    category: 'restaurant',
    coordinates: { latitude: 51.5055, longitude: -0.091 },
    rating: 4.7,
    photoUrl: 'https://picsum.photos/seed/monmouth/800/500',
    address: '2 Park St, London SE1 9AB',
    hours: 'Open 07:30 – 17:00',
    website: 'https://www.monmouthcoffee.co.uk',
  },
  {
    id: 'borough-market-kitchen',
    name: 'Borough Market Kitchen',
    category: 'restaurant',
    coordinates: { latitude: 51.5056, longitude: -0.0917 },
    rating: 4.5,
    photoUrl: 'https://picsum.photos/seed/borough-market/800/500',
    address: 'Borough Market, 8 Southwark St, London SE1 1TL',
    hours: 'Open 10:00 – 17:00',
    website: 'https://boroughmarket.org.uk',
  },
  {
    id: 'the-george-inn',
    name: 'The George Inn',
    category: 'pub',
    coordinates: { latitude: 51.5041, longitude: -0.09 },
    rating: 4.5,
    photoUrl: 'https://picsum.photos/seed/george-inn/800/500',
    address: '75-77 Borough High St, London SE1 1NH',
    hours: 'Open 11:00 – 23:00',
    website: 'https://www.greeneking.co.uk/pubs/greater-london/george-inn',
    story:
      "The George Inn is London's last surviving galleried coaching inn, rebuilt in 1677 after a fire and now owned by the National Trust. Charles Dickens drank here and mentioned the pub in Little Dorrit.",
  },
  {
    id: 'the-anchor-bankside',
    name: 'The Anchor Bankside',
    category: 'pub',
    coordinates: { latitude: 51.5069, longitude: -0.0922 },
    rating: 4.3,
    photoUrl: 'https://picsum.photos/seed/anchor-bankside/800/500',
    address: '34 Park St, London SE1 9EF',
    hours: 'Open 11:00 – 23:00',
  },
  {
    id: 'the-market-porter',
    name: 'The Market Porter',
    category: 'pub',
    coordinates: { latitude: 51.5052, longitude: -0.0912 },
    rating: 4.4,
    photoUrl: 'https://picsum.photos/seed/market-porter/800/500',
    address: '9 Stoney St, London SE1 9AA',
    hours: 'Open 11:00 – 23:00',
  },
];

/** Places for one section with distances from the user, nearest first. */
export function placesByCategory(
  category: PlaceCategory,
  userLocation: Coordinates
): PlaceWithDistance[] {
  return MockPlaces.filter((place) => place.category === category)
    .map((place) => {
      const distance = distanceMeters(userLocation, place.coordinates);
      return {
        ...place,
        distanceMeters: distance,
        // Demo-mode walking estimate: ~1.33 m/s along imaginary streets
        walkSeconds: Math.round(distance / 1.33),
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function placeById(id: string): Place | undefined {
  return MockPlaces.find((place) => place.id === id);
}
