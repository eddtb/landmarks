import { pickBestArticle } from '@/server/wikipedia';

describe('pickBestArticle', () => {
  test('picks the exact title match', () => {
    expect(pickBestArticle('Tower Bridge', ['Pool of London', 'Tower Bridge'])).toBe(
      'Tower Bridge'
    );
  });

  test('name similarity beats geographic proximity ordering', () => {
    // Real geosearch output: the nearest article to Tower Bridge's
    // coordinates is about a boat pageant that happened there
    const candidates = [
      'Thames Diamond Jubilee Pageant',
      'Hawker Hunter Tower Bridge incident',
      'Tower Bridge',
    ];
    expect(pickBestArticle('Tower Bridge', candidates)).toBe('Tower Bridge');
  });

  test('matches through punctuation and case differences', () => {
    expect(pickBestArticle("St Paul's Cathedral", ['st pauls cathedral'])).toBe(
      'st pauls cathedral'
    );
  });

  test('matches when one name contains the other', () => {
    expect(pickBestArticle('The George Inn', ['George Inn, Southwark'])).toBe(
      'George Inn, Southwark'
    );
  });

  test('returns null when nothing plausibly matches', () => {
    expect(
      pickBestArticle('Bomba Paella Stall', ['Southwark Cathedral', 'Borough Market'])
    ).toBeNull();
  });

  test('returns null for empty candidates', () => {
    expect(pickBestArticle('Tower Bridge', [])).toBeNull();
  });
});
