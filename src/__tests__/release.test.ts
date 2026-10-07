import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Konfiguracja wydania: eas.json i app.json (bez uruchamiania EAS / prebuild). */
const root = path.resolve(__dirname, '..', '..');
const json = (f: string) => JSON.parse(readFileSync(path.join(root, f), 'utf8'));

describe('eas.json', () => {
  const eas = json('eas.json');
  const b = eas.build;

  it('development: dev client, dystrybucja wewnętrzna, narzędzia dev', () => {
    expect(b.development).toMatchObject({ developmentClient: true, distribution: 'internal', env: { EXPO_PUBLIC_DEV_TOOLS: '1' } });
  });

  it('preview: dystrybucja wewnętrzna', () => {
    expect(b.preview.distribution).toBe('internal');
  });

  it('production: autoIncrement, Supabase, bez narzędzi dev', () => {
    expect(b.production.autoIncrement).toBe(true);
    expect(b.production.env.EXPO_PUBLIC_BACKEND).toBe('supabase');
    expect(b.production.env.EXPO_PUBLIC_DEV_TOOLS).toBeUndefined();
    expect(b.production.developmentClient).toBeFalsy();
    expect(b.production.distribution ?? 'store').toBe('store');
  });

  it('wersje buildów z app.json (appVersionSource: local)', () => {
    expect(eas.cli.appVersionSource).toBe('local');
  });
});

describe('app.json', () => {
  const expo = json('app.json').expo;
  const plugin = (name: string) => (expo.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === name) as [string, Record<string, unknown>];

  it('numery buildów i runtimeVersion', () => {
    expect(expo.ios.buildNumber).toMatch(/^\d+$/);
    expect(Number.isInteger(expo.android.versionCode)).toBe(true);
    expect(expo.runtimeVersion).toEqual({ policy: 'appVersion' });
  });

  it('iOS: bez szyfrowania niezwolnionego z eksportu', () => {
    expect(expo.ios.config.usesNonExemptEncryption).toBe(false);
  });

  it('Android: tylko używane uprawnienia, mikrofon i lokalizacja w tle zablokowane', () => {
    const perms: string[] = expo.android.permissions;
    const blocked: string[] = expo.android.blockedPermissions;
    for (const p of ['CAMERA', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'POST_NOTIFICATIONS']) {
      expect(perms).toContain(`android.permission.${p}`);
    }
    for (const p of ['RECORD_AUDIO', 'ACCESS_BACKGROUND_LOCATION']) {
      expect(blocked).toContain(`android.permission.${p}`);
      expect(perms).not.toContain(`android.permission.${p}`);
    }
    expect(perms.filter((p) => blocked.includes(p))).toEqual([]);
    expect(plugin('expo-camera')[1].recordAudioAndroid).toBe(false);
  });

  it('iOS: opisy uprawnień po polsku (bez angielskich domyślnych z pluginów)', () => {
    const texts = [
      ...Object.values(plugin('expo-location')[1]),
      plugin('expo-camera')[1].cameraPermission,
      plugin('expo-camera')[1].microphonePermission,
      ...Object.values(plugin('expo-image-picker')[1]),
    ];
    for (const t of texts) {
      expect(typeof t).toBe('string');
      expect(t as string).not.toMatch(/Allow \$\(PRODUCT_NAME\)/);
      expect(t as string).toMatch(/[ąćęłńóśźż]/i);
    }
    // Ten sam klucz NSCameraUsageDescription ustawiają dwa pluginy – tekst musi być jeden.
    expect(plugin('expo-image-picker')[1].cameraPermission).toBe(plugin('expo-camera')[1].cameraPermission);
    expect(plugin('expo-image-picker')[1].microphonePermission).toBe(plugin('expo-camera')[1].microphonePermission);
  });
});
