import { story } from '@/test-utils/story';
import { featuredStories } from '@/utils/featured';

describe('featuredStories (the mini featured listings)', () => {
  test('a Historic England grade outranks a longer story, Grade I above II* above II', () => {
    const gradeII = story({ pageId: 1, source: 'Wikipedia · Grade II listed', extract: 'x'.repeat(900) });
    const gradeI = story({ pageId: 2, source: 'Historic England · Grade I', extract: 'short' });
    const gradeIIstar = story({ pageId: 3, source: 'Wikipedia · Grade II* listed', extract: 'short' });
    const plain = story({ pageId: 4, extract: 'x'.repeat(2000) });
    expect(featuredStories([plain, gradeII, gradeIIstar, gradeI]).map((s) => s.pageId)).toEqual([
      2, 3, 1, 4,
    ]);
  });

  test('richer stories beat thinner ones when no grade separates them', () => {
    const thin = story({ pageId: 1, extract: 'short' });
    const rich = story({ pageId: 2, extract: 'x'.repeat(500) });
    expect(featuredStories([thin, rich])[0].pageId).toBe(2);
  });

  test('no photo or a pastTag disqualifies; the standing-on item is never double-featured', () => {
    const noPhoto = story({ pageId: 1, thumbnailUrl: undefined });
    const gone = story({ pageId: 2, pastTag: 'Demolished 1694' });
    const standing = story({ pageId: 3 });
    const ok = story({ pageId: 4 });
    expect(featuredStories([noPhoto, gone, standing, ok], 3).map((s) => s.pageId)).toEqual([4]);
  });

  test('the rail caps at six', () => {
    const many = Array.from({ length: 10 }, (_, i) => story({ pageId: i + 1 }));
    expect(featuredStories(many)).toHaveLength(6);
  });
});
