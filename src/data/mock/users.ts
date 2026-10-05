import type { PostAuthor, User } from '@/types';

export const START_USER: User = {
  id: 'u-kuba',
  name: 'Kuba Nowak',
  firstName: 'Kuba',
  handle: '@kuba.grzyb',
  level: 14,
  xp: 2340,
  streakDays: 3,
  tripsCount: 42,
  mushroomsCount: 318,
  homeGminaId: 'suprasl',
};

/** Liczniki postępu odznak i osiągnięć na starcie (9 borowików → dziesiąty odblokuje „Króla Puszczy”). */
export const START_COUNTERS = {
  borowikiKnyszynska: 9,
  totalKm: 196.4,
  streakDays: 3,
  legendaryFinds: 0,
  /** Okazy XXL – osiągnięcie „Okazy XXL” (brąz zdobyty, srebro przy 5). */
  xxlFinds: 3,
};

export const START_BADGES = ['ranny-ptaszek', 'km-100', 'seria-7'];

/** Wkład użytkownika w punkty gminy w bieżącym tygodniu (makieta: 1 280 pkt). */
export const START_WEEKLY_CONTRIBUTION = 1280;

export const AUTHORS: Record<string, PostAuthor> = {
  ola: { id: 'u-ola', name: 'Ola_W', level: 27, ringRarity: 'legendarny' },
  marek: { id: 'u-marek', name: 'Marek_K', level: 20, ringRarity: 'primary' },
  bartek: { id: 'u-bartek', name: 'Bartek', level: 11, ringRarity: 'rzadki' },
  ewa: { id: 'u-ewa', name: 'Ewa.las', level: 18, ringRarity: 'epicki' },
  grzybiarz: { id: 'u-g77', name: 'Grzybiarz77', level: 9, ringRarity: 'pospolity' },
  kasia: { id: 'u-kasia', name: 'Kasia_P', level: 15, ringRarity: 'rzadki' },
  tomek: { id: 'u-tomek', name: 'Tomek_B', level: 12, ringRarity: 'pospolity' },
};
