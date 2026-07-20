import { creditLine, pickCommonsFile } from '@/server/commons';

// Recorded from the live Commons geosearch at the Cutty Sark and the
// Doug Mullins corner, 2026-07-21 — the bus is genuinely the nearest
// file to the ship
const info = (thumburl: string, artist?: string, license?: string) => [
  {
    thumburl,
    extmetadata: {
      Artist: { value: artist },
      LicenseShortName: { value: license },
    },
  },
];

const cuttySarkPages = [
  { title: 'File:BandSports London 2012 bus (FTE 630B).jpg', imageinfo: info('https://up/bus.jpg') },
  { title: 'File:Greenwich London June 2016.jpg', imageinfo: info('https://up/greenwich.jpg') },
  { title: 'File:The Cutty Sark (42057143694).jpg', imageinfo: info('https://up/ship.jpg') },
];

describe('pickCommonsFile', () => {
  test('the story name beats proximity: the ship wins, not the bus', () => {
    const picked = pickCommonsFile('Cutty Sark', cuttySarkPages);
    expect(picked?.title).toBe('File:The Cutty Sark (42057143694).jpg');
  });

  test('one shared token is coincidence, not a match', () => {
    // "Greenwich" alone matches half the borough's photographs
    expect(pickCommonsFile('Greenwich Theatre', cuttySarkPages)).toBeNull();
  });

  test('finds the photo of the exact plaque', () => {
    const pages = [
      { title: 'File:Close-up of the inscription (OpenBenches 5120).jpg', imageinfo: info('https://up/bench.jpg') },
      { title: 'File:Doug Mullins (Dairyman) Plaque.jpg', imageinfo: info('https://up/plaque.jpg') },
    ];
    expect(pickCommonsFile('Doug Mullins 1932-1991 Master Dairyman', pages)?.title).toContain(
      'Doug Mullins'
    );
  });

  test('files without a thumbnail never win', () => {
    expect(pickCommonsFile('Cutty Sark', [{ title: 'File:Cutty Sark plans.jpg' }])).toBeNull();
  });
});

describe('creditLine', () => {
  test('strips the HTML Commons wraps around artist names', () => {
    const page = {
      title: 'File:X.jpg',
      imageinfo: info(
        'https://up/x.jpg',
        '<a href="//commons.wikimedia.org/wiki/User:Endim8" title="User:Endim8">Endim8</a>',
        'CC BY 4.0'
      ),
    };
    expect(creditLine(page)).toBe('Photo: Endim8 / Commons (CC BY 4.0)');
  });
});
