import { describe, expect, it } from '@jest/globals';

import type { Find } from '@/types';
import {
  dataUriTotal,
  isRemotePhoto,
  jpegDataUriLength,
  latestSpeciesPhoto,
  remotePhotoPath,
  remotePhotoUri,
  rerootPhotoUri,
  trimPhotoBudget,
} from '../findPhoto';

const find = (id: string, foundAt: string, extra: Partial<Find> = {}): Find => ({
  id,
  tripId: 't1',
  speciesId: 'borowik-szlachetny',
  gminaId: 'suprasl',
  rarity: 'rzadki',
  confidence: 0.9,
  xxl: false,
  dimensions: { capCm: 10, heightCm: 12, weightG: 200, ageDays: 3 },
  collected: true,
  status: 'claimed',
  foundAt,
  ...extra,
});

describe('rerootPhotoUri', () => {
  const doc = 'file:///var/mobile/Containers/Data/Application/NEW/Documents/';

  it('przenosi plik z finds/ do bieżącego katalogu dokumentów', () => {
    const old = 'file:///var/mobile/Containers/Data/Application/OLD/Documents/finds/photo_abc.jpg';
    expect(rerootPhotoUri(old, doc)).toBe(`${doc}finds/photo_abc.jpg`);
    expect(rerootPhotoUri(old, doc.slice(0, -1))).toBe(`${doc}finds/photo_abc.jpg`);
  });

  it('nie rusza data:, blob: ani plików spoza finds/', () => {
    expect(rerootPhotoUri('data:image/jpeg;base64,AAAA', doc)).toBe('data:image/jpeg;base64,AAAA');
    expect(rerootPhotoUri('blob:http://localhost:8081/x', doc)).toBe('blob:http://localhost:8081/x');
    expect(rerootPhotoUri('file:///cache/Camera/x.jpg', doc)).toBe('file:///cache/Camera/x.jpg');
    expect(rerootPhotoUri('file:///a/finds/x.jpg', '')).toBe('file:///a/finds/x.jpg');
  });
});

describe('trimPhotoBudget', () => {
  const photo = (n: number) => `data:image/jpeg;base64,${'A'.repeat(n)}`;

  it('mieści się w budżecie → bez zmian', () => {
    const finds = { a: find('a', '2026-10-01T10:00:00Z', { photoUri: photo(100) }) };
    expect(trimPhotoBudget(finds, 1000)).toBeNull();
  });

  it('zdejmuje zdjęcia z najstarszych znalezisk, pliki natywne zostawia', () => {
    const finds = {
      old: find('old', '2026-10-01T10:00:00Z', { photoUri: photo(400) }),
      mid: find('mid', '2026-10-02T10:00:00Z', { photoUri: photo(400) }),
      fresh: find('fresh', '2026-10-03T10:00:00Z', { photoUri: photo(400) }),
      file: find('file', '2026-09-01T10:00:00Z', { photoUri: 'file:///doc/finds/x.jpg' }),
    };
    const out = trimPhotoBudget(finds, 1000);
    expect(out).not.toBeNull();
    expect(out?.fresh.photoUri).toBe(finds.fresh.photoUri);
    expect(out?.mid.photoUri).toBe(finds.mid.photoUri);
    expect(out?.old.photoUri).toBeUndefined();
    expect(out?.old.speciesId).toBe('borowik-szlachetny');
    expect(out?.file.photoUri).toBe('file:///doc/finds/x.jpg');
  });

  it('zdjęcie, które jest też na serwerze (photoPath), zostaje znacznikiem sb-photo: zamiast pasków', () => {
    const finds = {
      old: find('old', '2026-10-01T10:00:00Z', { photoUri: photo(600), photoPath: 'u1/old.jpg' }),
      fresh: find('fresh', '2026-10-03T10:00:00Z', { photoUri: photo(600) }),
    };
    const out = trimPhotoBudget(finds, 1000);
    expect(out?.old).toMatchObject({ photoUri: 'sb-photo:u1/old.jpg', photoPath: 'u1/old.jpg' });
    expect(out?.fresh.photoUri).toBe(finds.fresh.photoUri);
    expect(dataUriTotal(out!)).toBe(finds.fresh.photoUri!.length);
  });
});

describe('znacznik zdjęcia z serwera (web)', () => {
  it('sb-photo:<ścieżka> ↔ ścieżka; zwykłe URI to nie znacznik', () => {
    expect(remotePhotoUri('u1/f.jpg')).toBe('sb-photo:u1/f.jpg');
    expect(remotePhotoPath('sb-photo:u1/f.jpg')).toBe('u1/f.jpg');
    expect(remotePhotoPath('sb-photo:')).toBeNull();
    expect(remotePhotoPath('data:image/jpeg;base64,AAAA')).toBeNull();
    expect(remotePhotoPath(undefined)).toBeNull();
    expect(isRemotePhoto('sb-photo:u1/f.jpg')).toBe(true);
    expect(isRemotePhoto('file:///finds/a.jpg')).toBe(false);
  });

  it('długość data URI JPEG-a (budżet localStorage)', () => {
    expect(jpegDataUriLength(3)).toBe('data:image/jpeg;base64,'.length + 4);
    expect(jpegDataUriLength(4)).toBe('data:image/jpeg;base64,'.length + 8);
  });
});

describe('latestSpeciesPhoto', () => {
  it('najnowsze odebrane znalezisko gatunku ze zdjęciem', () => {
    const finds = {
      a: find('a', '2026-10-01T10:00:00Z', { photoUri: 'file:///finds/a.jpg' }),
      b: find('b', '2026-10-03T10:00:00Z', { photoUri: 'file:///finds/b.jpg' }),
      c: find('c', '2026-10-04T10:00:00Z', { photoUri: 'file:///finds/c.jpg', status: 'pending' }),
      d: find('d', '2026-10-05T10:00:00Z'),
      e: find('e', '2026-10-06T10:00:00Z', { photoUri: 'file:///finds/e.jpg', speciesId: 'czubajka-kania' }),
    };
    expect(latestSpeciesPhoto(finds, 'borowik-szlachetny')).toBe('file:///finds/b.jpg');
    expect(latestSpeciesPhoto(finds, 'maslak-zwyczajny')).toBeUndefined();
  });
});
