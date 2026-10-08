import { describe, expect, it, jest } from '@jest/globals';

import { migrateSimState, releaseSimState, type SimData } from '../useSimStore';

/* eslint-disable @typescript-eslint/no-require-imports */
// AsyncStorage z pamięci – osobna instancja w każdym jest.isolateModules.
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

type SimModule = typeof import('../useSimStore');
type Storage = { setItem(k: string, v: string): Promise<void> };

/** Zapis z buildu deweloperskiego: symulacja wszystkiego, co da się przestawić w panelu /dev. */
const DEV_SAVE: Partial<SimData> = {
  locationSource: 'sim',
  cameraSource: 'sim',
  simPoint: 'abroad',
  forcedGminaId: 'suprasl',
  gpsEnabled: false,
  networkEnabled: false,
  timeSpeed: 10,
  scan: { force: 'species', speciesId: 'muchomor-sromotnikowy', xxl: true, lowConfidence: true },
  permissions: { location: 'granted', camera: 'denied' },
};

/** Zapis sprzed wersji 2 (symulowany skan 360°). */
const V1_SAVE = {
  ...DEV_SAVE,
  devMode: true,
  scan: { speciesId: 'muchomor-sromotnikowy', rarity: 'legendarny', xxl: true, poisonous: true, lowConfidence: true },
  scanSeq: 7,
  scanFreezeAt: 0.68,
};

/** Świeży moduł store'u z podmienioną flagą DEV_TOOLS i zapisanym stanem w AsyncStorage. */
async function hydrate(devTools: boolean, saved: object, version = 2) {
  let mod!: SimModule;
  let storage!: Storage;
  jest.isolateModules(() => {
    jest.doMock('../../config', () => ({ DEV_TOOLS: devTools, devToolsEnabled: () => devTools }));
    const m = require('@react-native-async-storage/async-storage') as { default?: Storage } & Storage;
    storage = m.default ?? m;
    mod = require('../useSimStore') as SimModule;
  });
  await storage.setItem('grzyb.sim.v1', JSON.stringify({ state: saved, version }));
  await mod.useSimStore.persist.rehydrate();
  return mod.useSimStore.getState();
}
/* eslint-enable @typescript-eslint/no-require-imports */

describe('useSimStore – wydanie bez narzędzi dev', () => {
  it('releaseSimState: urządzenie, sieć, czas rzeczywisty, bez wymuszonego wyniku skanu; zgody zostają', () => {
    const out = releaseSimState(DEV_SAVE as SimData);
    expect(out).toMatchObject({
      locationSource: 'device',
      cameraSource: 'device',
      simPoint: 'gmina',
      forcedGminaId: null,
      gpsEnabled: true,
      networkEnabled: true,
      timeSpeed: 1,
      scan: { force: 'off', speciesId: null, xxl: false, lowConfidence: false },
      permissions: { location: 'granted', camera: 'denied' },
    });
  });

  it('DEV_TOOLS = false: zapis z buildu deweloperskiego nie przełącza na symulację', async () => {
    const s = await hydrate(false, DEV_SAVE);
    expect(s.locationSource).toBe('device');
    expect(s.cameraSource).toBe('device');
    expect(s.networkEnabled).toBe(true);
    expect(s.gpsEnabled).toBe(true);
    expect(s.timeSpeed).toBe(1);
    expect(s.scan.force).toBe('off');
    expect(s.scan.speciesId).toBeNull();
    // Akcje store'u przetrwały scalanie.
    expect(typeof s.set).toBe('function');
  });

  it('DEV_TOOLS = true: zapis symulacji wraca bez zmian', async () => {
    const s = await hydrate(true, DEV_SAVE);
    expect(s.locationSource).toBe('sim');
    expect(s.cameraSource).toBe('sim');
    expect(s.networkEnabled).toBe(false);
    expect(s.forcedGminaId).toBe('suprasl');
    expect(s.scan).toEqual({ force: 'species', speciesId: 'muchomor-sromotnikowy', xxl: true, lowConfidence: true });
  });

  it('zapis sprzed wersji 2 (symulowany skan): wymuszenia i liczniki znikają, reszta symulacji zostaje', async () => {
    const m = migrateSimState(V1_SAVE, 1) as Record<string, unknown>;
    expect(m.scan).toEqual({ force: 'off', speciesId: null, xxl: false, lowConfidence: false });
    expect(m).not.toHaveProperty('devMode');
    expect(m).not.toHaveProperty('scanSeq');
    expect(m).not.toHaveProperty('scanFreezeAt');
    const s = await hydrate(true, V1_SAVE, 1);
    expect(s.locationSource).toBe('sim');
    expect(s.forcedGminaId).toBe('suprasl');
    expect(s.scan.force).toBe('off');
    expect(s).not.toHaveProperty('scanSeq');
  });
});
