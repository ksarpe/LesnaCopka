/**
 * Flagi wydania (czytane raz, przy starcie bundla).
 *
 * `EXPO_PUBLIC_*` Metro wkleja do bundla w chwili budowania – zmiana wymaga restartu `npx expo start`
 * albo nowego buildu (profile w eas.json). Odwołanie musi być dosłowne (`process.env.EXPO_PUBLIC_DEV_TOOLS`),
 * inaczej Metro go nie podmieni.
 */

/**
 * Narzędzia deweloperskie: panel `/dev` (Ustawienia → „Panel symulacji (dev)”, przytrzymanie avatara na Starcie),
 * symulowana pozycja i aparat. W dev zawsze; w buildzie tylko z `EXPO_PUBLIC_DEV_TOOLS=1` (profile development
 * i preview w eas.json). Linki `?scenario=` działają wyłącznie w dev (`__DEV__`, web).
 */
export function devToolsEnabled(isDev: boolean, flag: string | undefined): boolean {
  return isDev || flag?.trim() === '1';
}

export const DEV_TOOLS = devToolsEnabled(__DEV__, process.env.EXPO_PUBLIC_DEV_TOOLS);
