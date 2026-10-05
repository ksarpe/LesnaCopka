/** Warunki odblokowania odznak: licznik w store użytkownika → próg. */
export const BADGE_RULES = {
  'krol-puszczy': { counter: 'borowikiKnyszynska', target: 10 },
  'km-100': { counter: 'totalKm', target: 100 },
  'seria-7': { counter: 'streakDays', target: 7 },
  'lowca-legend': { counter: 'legendaryFinds', target: 1 },
} as const;
