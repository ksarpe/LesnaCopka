import { describe, expect, it } from '@jest/globals';

import type { ScanView } from '@/types';

import { hasSpin, heroView, identifyViews, MAX_IDENTIFY_VIEWS, sideViews } from '../views';

const side = (az: number): ScanView => ({ uri: `file:///side-${az}.jpg`, kind: 'side', az, el: -40 });
const top: ScanView = { uri: 'file:///top.jpg', kind: 'top', az: 100, el: -75 };
const low: ScanView = { uri: 'file:///low.jpg', kind: 'low', az: 200, el: -10 };

describe('ujęcia skanu 3D', () => {
  it('klatki obrotu: same boki po azymucie; podgląd 3D od 3 boków', () => {
    const views = [side(0), top, side(240), side(90), low];
    expect(sideViews(views).map((v) => v.az)).toEqual([0, 90, 240]);
    expect(hasSpin(views)).toBe(true);
    expect(hasSpin([side(0), side(30), top])).toBe(false);
    expect(hasSpin(undefined)).toBe(false);
  });

  it('zdjęcie główne: pierwszy bok (start skanu), bez boków – pierwsze ujęcie', () => {
    expect(heroView([top, side(30), side(0)])).toEqual(side(30));
    expect(heroView([low, top])).toEqual(low);
    expect(heroView([])).toBeUndefined();
  });

  it('do rozpoznania: główne, przy ziemi, z góry, bok najdalej od głównego – najwyżej 4', () => {
    const views = [side(0), side(30), top, side(170), side(200), low, side(320)];
    const picked = identifyViews(views);
    expect(picked).toHaveLength(MAX_IDENTIFY_VIEWS);
    expect(picked.map((v) => v.uri)).toEqual([side(0).uri, low.uri, top.uri, side(170).uri]);
  });

  it('bez ujęć z góry i przy ziemi – główne i druga strona', () => {
    expect(identifyViews([side(10), side(60), side(200)]).map((v) => v.az)).toEqual([10, 200]);
    expect(identifyViews([side(10)])).toEqual([side(10)]);
    expect(identifyViews([])).toEqual([]);
  });
});
