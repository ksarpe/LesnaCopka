/**
 * Warunki odblokowania odznak: licznik gracza (src/utils/counters.ts) → próg. Te same warunki liczy serwer
 * (`evaluate_badges`, reguły z seedu – scripts/gen-seed.ts): Ranny ptaszek = wyprawa rozpoczęta przed 6:00,
 * 100 km = dystans uznany na wyprawach, Seria 7 dni = bieżąca seria, Łowca Legend = okaz legendarny,
 * Król Puszczy = 10 zebranych borowików szlachetnych w gminach Puszczy Knyszyńskiej.
 */
export const BADGE_RULES = {
  'krol-puszczy': { counter: 'borowikiKnyszynska', target: 10 },
  'ranny-ptaszek': { counter: 'earlyTrips', target: 1 },
  'km-100': { counter: 'totalKm', target: 100 },
  'seria-7': { counter: 'streakDays', target: 7 },
  'lowca-legend': { counter: 'legendaryFinds', target: 1 },
} as const;
