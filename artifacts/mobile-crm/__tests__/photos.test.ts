import { describe, expect, it } from 'vitest';
import { extractPhotoPaths, flattenPhotoPaths, photoUrl } from '../lib/photos';

describe('extractPhotoPaths', () => {
  it('returns object-storage paths from photoPaths metadata', () => {
    expect(
      extractPhotoPaths({ photoPaths: ['/objects/uploads/a.jpg', '/objects/uploads/b.png'] }),
    ).toEqual(['/objects/uploads/a.jpg', '/objects/uploads/b.png']);
  });

  it('returns [] for missing or null metadata', () => {
    expect(extractPhotoPaths(undefined)).toEqual([]);
    expect(extractPhotoPaths(null)).toEqual([]);
    expect(extractPhotoPaths({})).toEqual([]);
  });

  it('ignores non-array photoPaths values', () => {
    expect(extractPhotoPaths({ photoPaths: '/objects/a.jpg' })).toEqual([]);
    expect(extractPhotoPaths({ photoPaths: { 0: '/objects/a.jpg' } })).toEqual([]);
    expect(extractPhotoPaths({ photoPaths: 42 })).toEqual([]);
  });

  it('drops non-string entries', () => {
    expect(
      extractPhotoPaths({ photoPaths: [null, 7, { path: '/objects/x.jpg' }, '/objects/ok.jpg'] }),
    ).toEqual(['/objects/ok.jpg']);
  });

  it('drops paths not starting with /objects/', () => {
    expect(
      extractPhotoPaths({
        photoPaths: ['https://evil.example/a.jpg', '/uploads/b.jpg', 'objects/c.jpg', '/objects/d.jpg'],
      }),
    ).toEqual(['/objects/d.jpg']);
  });
});

describe('flattenPhotoPaths', () => {
  it('preserves timeline order across activities', () => {
    const activities = [
      { metadata: { photoPaths: ['/objects/1.jpg', '/objects/2.jpg'] } },
      { metadata: null },
      { metadata: { photoPaths: 'not-an-array' } },
      { metadata: { photoPaths: ['/objects/3.jpg'] } },
      { metadata: { note: 'no photos' } },
      { metadata: { photoPaths: ['/skip/x.jpg', '/objects/4.jpg'] } },
    ];
    expect(flattenPhotoPaths(activities)).toEqual([
      '/objects/1.jpg',
      '/objects/2.jpg',
      '/objects/3.jpg',
      '/objects/4.jpg',
    ]);
  });

  it('returns [] for no activities', () => {
    expect(flattenPhotoPaths([])).toEqual([]);
  });
});

describe('photoUrl', () => {
  it('maps object paths to the storage API route', () => {
    expect(photoUrl('/objects/uploads/a.jpg')).toContain('/api/v1/storage/objects/uploads/a.jpg');
  });
});
