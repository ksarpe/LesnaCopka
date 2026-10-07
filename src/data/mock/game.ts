import type { Badge, Quest } from '@/types';

import { SPECIES } from './species';

/** Odznaki w kolejności z profilu (makieta: 5 odznak, ostatnia zablokowana). */
export const BADGES: Badge[] = [
  {
    id: 'krol-puszczy',
    name: 'Król Puszczy',
    icon: 'military_tech',
    color: '#EFA831',
    iconColor: '#4A3200',
    description: '10 borowików w Puszczy Knyszyńskiej',
  },
  {
    id: 'ranny-ptaszek',
    name: 'Ranny ptaszek',
    icon: 'wb_twilight',
    color: '#2B99E7',
    iconColor: '#0E2442',
    description: 'Wyprawa rozpoczęta przed 6:00',
  },
  {
    id: 'km-100',
    name: '100 km',
    icon: 'hiking',
    color: '#7FB547',
    iconColor: '#1F3310',
    description: '100 km przebytych na wyprawach',
  },
  {
    id: 'seria-7',
    name: 'Seria 7 dni',
    icon: 'local_fire_department',
    color: '#A56CDE',
    iconColor: '#2A0D3A',
    description: '7 dni z rzędu w lesie',
  },
  {
    id: 'lowca-legend',
    name: 'Łowca Legend',
    icon: 'diamond',
    color: '#EFA831',
    iconColor: '#4A3200',
    description: 'Znajdź gatunek legendarny',
  },
];

/** Zadania dnia z makiety – początek puli; scenariusze dev-linków przypinają je jako zadania dnia. */
export const DAILY_QUESTS: Quest[] = [
  {
    id: 'q-scan-5',
    kind: 'scans',
    title: 'Zeskanuj 5 grzybów',
    icon: 'photo_camera',
    iconBg: '#EEF5E3',
    iconColor: '#4C7A22',
    xp: 100,
    target: 5,
    difficulty: 1,
  },
  {
    id: 'q-rare-1',
    kind: 'rare',
    title: 'Znajdź rzadki gatunek',
    icon: 'diamond',
    iconFilled: true,
    iconBg: '#E9EEF9',
    iconColor: '#0068B2',
    xp: 150,
    target: 1,
    difficulty: 2,
  },
  {
    id: 'q-km-5',
    kind: 'distance',
    title: 'Przejdź 5 km',
    icon: 'hiking',
    iconBg: '#FFF0DD',
    iconColor: '#A2560F',
    xp: 80,
    target: 5,
    difficulty: 2,
  },
];

/* ───────────────────────── Pula zadań (losowanie: src/utils/quests.ts) ───────────────────────── */

const TINT = {
  green: { iconBg: '#EEF5E3', iconColor: '#4C7A22' },
  blue: { iconBg: '#E9EEF9', iconColor: '#0068B2' },
  orange: { iconBg: '#FFF0DD', iconColor: '#A2560F' },
  purple: { iconBg: '#F3E9FB', iconColor: '#7A41AF' },
  gold: { iconBg: '#FDF1D8', iconColor: '#8A6A1E' },
  red: { iconBg: '#FCE4DE', iconColor: '#B0452E' },
  info: { iconBg: '#E6EEF8', iconColor: '#2D5482' },
  dawn: { iconBg: '#FFE7CF', iconColor: '#8A4310' },
} as const;

type QuestDef = Omit<Quest, 'iconBg' | 'iconColor'> & { tint: keyof typeof TINT };
const quest = ({ tint, ...q }: QuestDef): Quest => ({ ...q, ...TINT[tint] });

/** Dzienne (poza zadaniami z makiety). difficulty: 1 łatwe · 2 średnie · 3 trudne. */
const DAILY_POOL: Quest[] = (
  [
    { id: 'd-scan-3', kind: 'scans', title: 'Zeskanuj 3 grzyby', icon: 'photo_camera', tint: 'green', xp: 60, target: 3, difficulty: 1 },
    { id: 'd-scan-10', kind: 'scans', title: 'Zeskanuj 10 grzybów', icon: 'photo_camera', tint: 'green', xp: 180, target: 10, difficulty: 3 },
    { id: 'd-km-2', kind: 'distance', title: 'Przejdź 2 km', icon: 'hiking', tint: 'orange', xp: 50, target: 2, difficulty: 1 },
    { id: 'd-km-10', kind: 'distance', title: 'Przejdź 10 km', icon: 'hiking', tint: 'orange', xp: 200, target: 10, difficulty: 3 },
    { id: 'd-epic-1', kind: 'epic', title: 'Znajdź epicki okaz', icon: 'stars', iconFilled: true, tint: 'purple', xp: 300, target: 1, difficulty: 3 },
    { id: 'd-xxl-1', kind: 'xxl', title: 'Znajdź okaz XXL', icon: 'egg', iconFilled: true, tint: 'gold', xp: 150, target: 1, difficulty: 3 },
    {
      id: 'd-trip-60',
      kind: 'tripMinutes',
      title: 'Spędź w lesie ponad godzinę',
      icon: 'schedule',
      tint: 'orange',
      xp: 100,
      target: 1,
      minutes: 60,
      difficulty: 2,
    },
    { id: 'd-new-species', kind: 'newSpecies', title: 'Odkryj nowy gatunek do atlasu', icon: 'menu_book', tint: 'green', xp: 120, target: 1, difficulty: 2 },
    { id: 'd-poison-photo', kind: 'poisonPhoto', title: 'Sfotografuj grzyba trującego', icon: 'shield', tint: 'red', xp: 80, target: 1, difficulty: 2 },
    { id: 'd-away', kind: 'awayGmina', title: 'Znajdź grzyba poza gminą domową', icon: 'explore', tint: 'info', xp: 120, target: 1, difficulty: 2 },
    { id: 'd-edible-5', kind: 'edible', title: 'Zbierz 5 jadalnych grzybów', icon: 'restaurant', tint: 'green', xp: 80, target: 5, difficulty: 1 },
    { id: 'd-variety-3', kind: 'variety', title: 'Znajdź 3 różne gatunki', icon: 'collections_bookmark', tint: 'purple', xp: 100, target: 3, difficulty: 2 },
    { id: 'd-publish', kind: 'publish', title: 'Opublikuj wyprawę w feedzie', icon: 'ios_share', tint: 'info', xp: 60, target: 1, difficulty: 1 },
    { id: 'd-react-3', kind: 'reactions', title: 'Daj „Darz grzyb!” 3 wyprawom', icon: 'favorite', iconFilled: true, tint: 'red', xp: 50, target: 3, difficulty: 1 },
    { id: 'd-early-7', kind: 'earlyStart', title: 'Wyrusz do lasu przed 7:00', icon: 'wb_twilight', tint: 'dawn', xp: 100, target: 1, beforeHour: 7, difficulty: 2 },
  ] satisfies QuestDef[]
).map(quest);

/** Miesiące sezonu (1–12) z `Species.seasonWeights`: waga ≥ 0,5. */
export function seasonMonths(weights: readonly number[] | undefined): number[] {
  return (weights ?? []).flatMap((w, i) => (w >= 0.5 ? [i + 1] : []));
}

/**
 * „Znajdź gatunek” – tylko w sezonie gatunku (`seasonMonths`). Gatunek bez `seasonWeights` (albo spoza katalogu)
 * – zadania nie ma w puli.
 */
const SEASONAL: { speciesId: string; title: string; xp: number; difficulty: 1 | 2 | 3 }[] = [
  { speciesId: 'borowik-szlachetny', title: 'Znajdź borowika szlachetnego', xp: 150, difficulty: 2 },
  { speciesId: 'podgrzybek-brunatny', title: 'Znajdź podgrzybka brunatnego', xp: 60, difficulty: 1 },
  { speciesId: 'pieprznik-jadalny', title: 'Znajdź kurki', xp: 80, difficulty: 1 },
  { speciesId: 'czubajka-kania', title: 'Znajdź kanię', xp: 120, difficulty: 2 },
  { speciesId: 'mleczaj-rydz', title: 'Znajdź rydza', xp: 120, difficulty: 2 },
  { speciesId: 'opienka-miodowa', title: 'Znajdź opieńki', xp: 80, difficulty: 1 },
  { speciesId: 'smardz-jadalny', title: 'Znajdź smardza', xp: 200, difficulty: 3 },
];

const SEASONAL_POOL: Quest[] = SEASONAL.flatMap((x) => {
  const months = seasonMonths(SPECIES.find((s) => s.id === x.speciesId)?.seasonWeights);
  if (!months.length) return [];
  return [
    quest({
      id: `d-sp-${x.speciesId}`,
      kind: 'species',
      title: x.title,
      icon: 'eco',
      tint: 'green',
      xp: x.xp,
      target: 1,
      speciesId: x.speciesId,
      months,
      difficulty: x.difficulty,
    }),
  ];
});

/** Tygodniowe – większe cele i nagrody, reset w poniedziałek. */
const WEEKLY_POOL: Quest[] = (
  [
    { id: 'w-scan-40', kind: 'scans', title: 'Zeskanuj 40 grzybów', icon: 'photo_camera', tint: 'green', xp: 500, target: 40 },
    { id: 'w-km-25', kind: 'distance', title: 'Przejdź 25 km', icon: 'hiking', tint: 'orange', xp: 500, target: 25 },
    { id: 'w-rare-5', kind: 'rare', title: 'Znajdź 5 rzadkich okazów', icon: 'diamond', iconFilled: true, tint: 'blue', xp: 600, target: 5 },
    { id: 'w-epic-2', kind: 'epic', title: 'Znajdź 2 epickie okazy', icon: 'stars', iconFilled: true, tint: 'purple', xp: 800, target: 2 },
    { id: 'w-xxl-3', kind: 'xxl', title: 'Znajdź 3 okazy XXL', icon: 'egg', iconFilled: true, tint: 'gold', xp: 700, target: 3 },
    { id: 'w-trips-3', kind: 'trips', title: 'Zakończ 3 wyprawy', icon: 'flag', tint: 'orange', xp: 400, target: 3 },
    {
      id: 'w-trip-120',
      kind: 'tripMinutes',
      title: 'Spędź w lesie ponad 2 godziny naraz',
      icon: 'schedule',
      tint: 'orange',
      xp: 300,
      target: 1,
      minutes: 120,
    },
    { id: 'w-new-species-3', kind: 'newSpecies', title: 'Odkryj 3 nowe gatunki', icon: 'menu_book', tint: 'green', xp: 600, target: 3 },
    { id: 'w-variety-10', kind: 'variety', title: 'Znajdź 10 różnych gatunków', icon: 'collections_bookmark', tint: 'purple', xp: 500, target: 10 },
    { id: 'w-poison-3', kind: 'poisonPhoto', title: 'Sfotografuj 3 grzyby trujące', icon: 'shield', tint: 'red', xp: 400, target: 3 },
    { id: 'w-away-5', kind: 'awayGmina', title: 'Znajdź 5 grzybów poza gminą domową', icon: 'explore', tint: 'info', xp: 400, target: 5 },
    { id: 'w-publish-2', kind: 'publish', title: 'Opublikuj 2 wyprawy', icon: 'ios_share', tint: 'info', xp: 300, target: 2 },
    { id: 'w-react-15', kind: 'reactions', title: 'Daj „Darz grzyb!” 15 wyprawom', icon: 'favorite', iconFilled: true, tint: 'red', xp: 300, target: 15 },
  ] satisfies QuestDef[]
).map((q) => quest({ ...q, period: 'weekly', difficulty: 2 }));

/**
 * Cała pula zadań – kolejność = `quest_templates.sort` w seedzie (od niej zależy losowanie, także na serwerze):
 * zadania z makiety, dzienne, sezonowe, tygodniowe.
 */
export const QUEST_POOL: Quest[] = [...DAILY_QUESTS, ...DAILY_POOL, ...SEASONAL_POOL, ...WEEKLY_POOL];
