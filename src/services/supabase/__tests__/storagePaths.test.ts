import { describe, expect, it } from '@jest/globals';

import {
  avatarPhotoPath,
  BUCKET_LIMIT_BYTES,
  coverPhotoPath,
  findPhotoPath,
  groupByBucket,
  isBucket,
  isOwnPath,
  nonceFrom,
  parseStorageRefs,
  publicObjectUrl,
  storageSyncError,
  tooLargeError,
} from '../storagePaths';
import { classifyError, errorMessage } from '../syncRpc';

const UID = '5b0e7c1a-2f3d-4c5e-8a9b-0c1d2e3f4a5b';
const FIND = '0f9e8d7c-6b5a-4c3d-9e1f-a2b3c4d5e6f7';
const TRIP = '11111111-2222-4333-8444-555555555555';

describe('ścieżki obiektów (kontrakt etapu 5: bez nazwy koszyka, folder gracza)', () => {
  it('znalezisko, okładka, avatar', () => {
    expect(findPhotoPath(UID, FIND)).toBe(`${UID}/${FIND}.jpg`);
    expect(coverPhotoPath(UID, TRIP, 'a1b2c3d4')).toBe(`${UID}/${TRIP}-a1b2c3d4.jpg`);
    expect(avatarPhotoPath(UID, 1_700_000_000_123.4)).toBe(`${UID}/avatar-1700000000123.jpg`);
  });

  it('nonce okładki: 8 znaków hex z uuid zdarzenia (stały przy ponowieniach)', () => {
    expect(nonceFrom('9F3A1B2C-0000-4000-8000-000000000000')).toBe('9f3a1b2c');
    expect(nonceFrom('ab-c')).toBe('abc00000');
    expect(nonceFrom('9F3A1B2C-0000-4000-8000-000000000000')).toBe(nonceFrom('9F3A1B2C-0000-4000-8000-000000000000'));
  });

  it('ścieżki pasują do reguły serwera (is_user_image_path) i do folderu gracza', () => {
    // Odpowiednik public.is_user_image_path z migracji 20261010100000_storage.sql.
    const serverRule = (path: string, uid: string) =>
      path.length <= 300 &&
      path.startsWith(`${uid}/`) &&
      /^([a-z0-9_-][a-z0-9._-]*\/)*[a-z0-9_-][a-z0-9._-]*\.(jpe?g|png|webp)$/i.test(path.slice(uid.length + 1));
    for (const p of [findPhotoPath(UID, FIND), coverPhotoPath(UID, TRIP, nonceFrom(FIND)), avatarPhotoPath(UID, Date.now())]) {
      expect(serverRule(p, UID)).toBe(true);
      expect(isOwnPath(UID, p)).toBe(true);
    }
    expect(isOwnPath(UID, `other/${FIND}.jpg`)).toBe(false);
    expect(isOwnPath(UID, `${UID}/../x.jpg`)).toBe(false);
    expect(isOwnPath(UID, `${UID}`)).toBe(false);
    expect(isOwnPath('', `/${FIND}.jpg`)).toBe(false);
  });

  it('limity koszyków jak na serwerze', () => {
    expect(BUCKET_LIMIT_BYTES).toEqual({ 'scan-photos': 2097152, 'post-media': 2097152, avatars: 524288 });
    expect(isBucket('post-media')).toBe(true);
    expect(isBucket('public')).toBe(false);
  });
});

describe('publiczny adres obiektu', () => {
  it('${SUPABASE_URL}/storage/v1/object/public/<bucket>/<path>, segmenty zakodowane', () => {
    expect(publicObjectUrl('avatars', `${UID}/avatar-1.jpg`, 'http://192.168.1.20:54321')).toBe(
      `http://192.168.1.20:54321/storage/v1/object/public/avatars/${UID}/avatar-1.jpg`,
    );
    expect(publicObjectUrl('post-media', '/u/a b#1.jpg', 'https://x.supabase.co/')).toBe(
      'https://x.supabase.co/storage/v1/object/public/post-media/u/a%20b%231.jpg',
    );
  });
});

describe('ścieżki z serwera do usunięcia (dev_reset_player().storagePaths)', () => {
  it('kontrakt: obiekt koszyk → ścieżki bez nazwy koszyka', () => {
    const refs = parseStorageRefs({
      'scan-photos': [`${UID}/${FIND}.jpg`, `${UID}/scan/x.jpg`],
      'post-media': [`${UID}/${TRIP}-a1b2c3d4.jpg`],
      avatars: [],
      nieznany: ['a/b.jpg'],
    });
    expect(refs).toEqual([
      { bucket: 'scan-photos', path: `${UID}/${FIND}.jpg` },
      { bucket: 'scan-photos', path: `${UID}/scan/x.jpg` },
      { bucket: 'post-media', path: `${UID}/${TRIP}-a1b2c3d4.jpg` },
    ]);
    expect(groupByBucket([...refs, refs[0]])).toEqual({
      'scan-photos': [`${UID}/${FIND}.jpg`, `${UID}/scan/x.jpg`],
      'post-media': [`${UID}/${TRIP}-a1b2c3d4.jpg`],
    });
  });

  it('obronnie: tablica „bucket/ścieżka”, {bucket, path} albo sama ścieżka (koszyk z nazwy pliku)', () => {
    expect(
      parseStorageRefs([
        `avatars/${UID}/avatar-1.jpg`,
        { bucket: 'post-media', path: `${UID}/c.jpg` },
        `${UID}/avatar-2.jpg`,
        `${UID}/${TRIP}-a1b2c3d4.jpg`,
        `${UID}/${FIND}.jpg`,
        '',
        7,
      ]),
    ).toEqual([
      { bucket: 'avatars', path: `${UID}/avatar-1.jpg` },
      { bucket: 'post-media', path: `${UID}/c.jpg` },
      { bucket: 'avatars', path: `${UID}/avatar-2.jpg` },
      { bucket: 'post-media', path: `${UID}/${TRIP}-a1b2c3d4.jpg` },
      { bucket: 'scan-photos', path: `${UID}/${FIND}.jpg` },
    ]);
    expect(parseStorageRefs(null)).toEqual([]);
  });
});

describe('błędy Storage → klasyfikacja kolejki', () => {
  const kind = (e: unknown) => classifyError(storageSyncError(e));

  it('413 / 415 – trwałe, czytelny komunikat (kod z treści albo HTTP)', () => {
    const big = storageSyncError({ name: 'StorageApiError', message: 'The object exceeded the maximum allowed size', status: 400, statusCode: '413' });
    expect(classifyError(big)).toBe('permanent');
    expect(big.message).toBe('zdjęcie za duże dla serwera (413)');
    expect(errorMessage(big)).toContain('maximum allowed size');
    const mime = storageSyncError({ message: 'mime type image/gif is not supported', status: 415 });
    expect(classifyError(mime)).toBe('permanent');
    expect(mime.message).toBe('nieobsługiwany format zdjęcia (415)');
    expect(classifyError(tooLargeError('avatars', 600 * 1024))).toBe('permanent');
  });

  it('sieć, 5xx, limit czasu → ponowienie; JWT → sesja; brak koszyka → chwilowy; RLS → trwały', () => {
    expect(kind({ name: 'StorageUnknownError', message: 'TypeError: Network request failed' })).toBe('network');
    expect(kind({ message: 'Bad Gateway', status: 502 })).toBe('network');
    expect(kind({ message: 'Too many', status: 429 })).toBe('network');
    expect(kind({ message: 'jwt expired', status: 400, statusCode: '403' })).toBe('auth');
    expect(kind({ message: 'Bucket not found', status: 400, statusCode: '404' })).toBe('server');
    expect(kind({ message: 'new row violates row-level security policy', status: 400, statusCode: '403' })).toBe('permanent');
  });
});
