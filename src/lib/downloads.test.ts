import { describe, expect, it } from 'vitest';

import { createUniqueFileNames } from './downloads';

describe('createUniqueFileNames', () => {
  it('preserves unique names and deduplicates collisions', () => {
    expect(createUniqueFileNames(['hero.jpg', 'hero.jpg', 'hero.png', 'hero.jpg'])).toEqual([
      'hero.jpg',
      'hero (2).jpg',
      'hero.png',
      'hero (3).jpg',
    ]);
  });

  it('handles names without extensions', () => {
    expect(createUniqueFileNames(['export', 'export'])).toEqual(['export', 'export (2)']);
  });
});
