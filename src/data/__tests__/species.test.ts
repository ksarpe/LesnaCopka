/**
 * Katalog gatunków (src/data/mock/species.ts): integralność danych i zasady bezpieczeństwa.
 * Źródła treści: docs/species-sources.md.
 */
import { describe, expect, it } from '@jest/globals';

import { SPECIES, START_ATLAS, TOTAL_SPECIES } from '../mock/species';
import type { Edibility, Habitat, Rarity } from '../../types';
import { isPhotoOnlySpecies, speciesLookalikes } from '../../utils/species';

const HABITATS: Habitat[] = ['iglasty', 'lisciasty', 'mieszany', 'laka', 'drewno', 'torfowisko', 'park'];
const EDIBILITY: Edibility[] = ['jadalny', 'niejadalny', 'trujacy', 'smiertelny'];

/** Gatunki sprzed rozbudowy katalogu – id zostają (atlas graczy, osiągnięcia, wyzwania gmin, baza). */
const LEGACY_IDS = [
  'borowik-szlachetny', 'podgrzybek-brunatny', 'czubajka-kania', 'muchomor-czerwony', 'pieprznik-jadalny', 'mleczaj-rydz',
  'szmaciak-galezisty', 'muchomor-zielonawy', 'smardz-jadalny', 'maslak-zwyczajny', 'kozlarz-babka', 'kozlarz-czerwony',
  'soplowka-jezowata', 'gaska-zielonka', 'opienka-miodowa', 'piestrzenica-kasztanowata', 'purchawka-chropowata',
  'golabek-zielonawy', 'zagwica-listkowata', 'goryczak-zolciowy', 'borowik-ceglastopory', 'muchomor-plamisty',
  'borowik-krolewski', 'plachetka-zwyczajna', 'czernidlak-kolpakowaty', 'zaslonak-rudy', 'sarniak-dachowkowaty',
  'maslak-sitarz', 'kozlarz-pomaranczowozolty', 'lejkowiec-dety', 'mleczaj-smaczny', 'siedzun-sosnowy',
  'borowik-szatanski', 'lakowka-ametystowa', 'gaska-siarkowa', 'strzepiak-ceglasty',
];

/** „Pieprznik jadalny (kurka)” → „pieprznik jadalny” – jak łączenie sobowtórów z katalogiem w seedzie i osiągnięciach. */
const nameKey = (name: string) => name.toLowerCase().replace(/ \(.*\)$/, '');
const byName = new Map(SPECIES.map((s) => [nameKey(s.name), s]));

describe('katalog gatunków', () => {
  it('120 gatunków o unikalnych id, nazwach i nazwach łacińskich; TOTAL_SPECIES = długość katalogu', () => {
    expect(SPECIES).toHaveLength(120);
    expect(TOTAL_SPECIES).toBe(SPECIES.length);
    expect(new Set(SPECIES.map((s) => s.id)).size).toBe(120);
    expect(new Set(SPECIES.map((s) => nameKey(s.name))).size).toBe(120);
    expect(new Set(SPECIES.map((s) => s.latin)).size).toBe(120);
    SPECIES.forEach((s) => expect(s.id).toMatch(/^[a-z]+(-[a-z]+)+$/));
  });

  it('zachowuje wszystkie dotychczasowe gatunki, pierwsze 9 w kolejności siatki z makiety', () => {
    expect(SPECIES.slice(0, LEGACY_IDS.length).map((s) => s.id)).toEqual(LEGACY_IDS);
    Object.keys(START_ATLAS).forEach((id) => expect(LEGACY_IDS).toContain(id));
  });

  it('rzadkość gry: 55 pospolitych / 35 rzadkich / 20 epickich / 10 legendarnych', () => {
    const count = (r: Rarity) => SPECIES.filter((s) => s.rarity === r).length;
    expect([count('pospolity'), count('rzadki'), count('epicki'), count('legendarny')]).toEqual([55, 35, 20, 10]);
  });

  it('sezon: 12 wag 0..1 ze szczytem = 1', () => {
    SPECIES.forEach((s) => {
      expect(s.seasonWeights).toHaveLength(12);
      s.seasonWeights!.forEach((w) => {
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      });
      expect(Math.max(...s.seasonWeights!)).toBe(1);
    });
  });

  it('fenologia: smardze i piestrzenica wiosną, kurka latem, płomiennica zimą, podgrzybek jesienią', () => {
    const w = (id: string, month: number) => SPECIES.find((s) => s.id === id)!.seasonWeights![month - 1];
    expect(w('smardz-jadalny', 4)).toBeGreaterThanOrEqual(0.8);
    expect(w('smardz-jadalny', 9)).toBe(0);
    expect(w('piestrzenica-kasztanowata', 4)).toBeGreaterThanOrEqual(0.5);
    expect(w('pieprznik-jadalny', 7)).toBeGreaterThanOrEqual(0.8);
    expect(w('pieprznik-jadalny', 1)).toBe(0);
    expect(w('podgrzybek-brunatny', 10)).toBeGreaterThanOrEqual(0.8);
    expect(w('podgrzybek-brunatny', 4)).toBe(0);
    expect(w('plomiennica-zimowa', 1)).toBeGreaterThanOrEqual(0.5);
  });

  it('siedliska, opis, wymiary i krótka nazwa', () => {
    SPECIES.forEach((s) => {
      expect(s.habitats?.length).toBeGreaterThan(0);
      s.habitats!.forEach((h) => expect(HABITATS).toContain(h));
      expect(new Set(s.habitats).size).toBe(s.habitats!.length);
      expect(s.habitat.length).toBeGreaterThan(0);
      expect(s.description?.length ?? 0).toBeGreaterThan(40);
      expect(s.shortName).toBe(s.shortName.toLowerCase());
      expect(s.shortName.length).toBeLessThanOrEqual(14);
      expect(s.typical.capCm).toBeGreaterThan(0);
      expect(s.typical.heightCm).toBeGreaterThan(0);
      expect(s.typical.weightG).toBeGreaterThan(0);
    });
  });

  it('gatunki trujące i śmiertelne mają opis z ostrzeżeniem', () => {
    SPECIES.filter((s) => s.edibility === 'trujacy' || s.edibility === 'smiertelny').forEach((s) => {
      expect(s.description).toMatch(/truj|śmiert|zatru|toksy|nie jeść|nie jedz|niebezpie|zgon|wymiot|nerk|muskaryn|amanityn|gyromitr|giromitr|nie zbieraj|groź/i);
    });
  });

  it('gatunki chronione: tylko „scisla” / „czesciowa”, opisane jako chronione i tylko do zdjęcia', () => {
    const protectedSpecies = SPECIES.filter((s) => s.protection);
    expect(protectedSpecies.length).toBeGreaterThan(10);
    protectedSpecies.forEach((s) => {
      expect(['scisla', 'czesciowa']).toContain(s.protection);
      expect(s.description).toMatch(/ochron/i);
      expect(isPhotoOnlySpecies(s)).toBe(true);
    });
    // Rozporządzenie MŚ z 9.10.2014 (Dz.U. 2014 poz. 1408): m.in.
    const p = (id: string) => SPECIES.find((s) => s.id === id)!.protection;
    expect(p('soplowka-jezowata')).toBe('scisla');
    expect(p('borowik-krolewski')).toBe('scisla');
    expect(p('borowik-szatanski')).toBe('scisla');
    expect(p('smardz-jadalny')).toBe('czesciowa');
    expect(p('zagwica-listkowata')).toBe('czesciowa');
    // Szmaciak (Sparassis crispa) wykreślony z listy w 2014 r.
    expect(p('szmaciak-galezisty')).toBeUndefined();
  });

  it('sobowtóry: 0–3, lookalike = pierwszy z lookalikes, zgodna jadalność z katalogiem', () => {
    SPECIES.forEach((s) => {
      const list = s.lookalikes ?? [];
      expect(list.length).toBeLessThanOrEqual(3);
      if (list.length) expect(s.lookalike).toEqual(list[0]);
      else expect(s.lookalike).toBeUndefined();
      expect(new Set(list.map((l) => l.name)).size).toBe(list.length);
      list.forEach((l) => {
        expect(EDIBILITY).toContain(l.edibility);
        expect(l.name).toBe(l.name.toLowerCase());
        expect(nameKey(l.name)).not.toBe(nameKey(s.name));
        expect(l.tip.length).toBeGreaterThan(10);
        expect(l.tip.length).toBeLessThanOrEqual(160);
        const inCatalog = byName.get(nameKey(l.name));
        if (inCatalog) expect([l.name, l.edibility]).toEqual([l.name, inCatalog.edibility]);
      });
    });
  });

  it('najgroźniejsze pomyłki są w katalogu sobowtórów', () => {
    const has = (id: string, name: string) => speciesLookalikes(SPECIES.find((s) => s.id === id)!).some((l) => l.name === name);
    expect(has('czubajka-kania', 'muchomor sromotnikowy')).toBe(true);
    expect(has('pieprznik-jadalny', 'lisówka pomarańczowa')).toBe(true);
    expect(has('smardz-jadalny', 'piestrzenica kasztanowata')).toBe(true);
    expect(has('opienka-miodowa', 'maślanka wiązkowa')).toBe(true);
    expect(has('opienka-miodowa', 'hełmówka jadowita')).toBe(true);
    expect(has('gaska-zielonka', 'muchomor zielonawy')).toBe(true);
    expect(has('pieczarka-polna', 'muchomor zielonawy')).toBe(true);
    expect(has('luszczak-zmienny', 'hełmówka jadowita')).toBe(true);
  });

  it('speciesLookalikes: najgroźniejsze najpierw, starsze dane z samym `lookalike`', () => {
    const l = speciesLookalikes({
      lookalikes: [
        { name: 'a', edibility: 'niejadalny', tip: 'x' },
        { name: 'b', edibility: 'smiertelny', tip: 'x' },
        { name: 'c', edibility: 'trujacy', tip: 'x' },
      ],
    });
    expect(l.map((x) => x.name)).toEqual(['b', 'c', 'a']);
    expect(speciesLookalikes({ lookalike: { name: 'z', edibility: 'jadalny', tip: 'x' } }).map((x) => x.name)).toEqual(['z']);
    expect(speciesLookalikes({})).toEqual([]);
  });
});
