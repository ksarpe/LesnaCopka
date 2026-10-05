/**
 * Design tokens 1:1 z „Grzybobranie UI v2.dc.html”.
 * Kolory OKLCH z pliku są przeliczone na sRGB (patrz NOTES.md).
 */
import type { Rarity } from '@/types';

export const colors = {
  bg: '#FAF6EE',
  canvas: '#EFE9DC',
  chip: '#EAE3D4',
  card: '#FFFFFF',
  ink: '#2E2B25',
  muted: '#6E685C',
  faint: '#8C8574',
  disabled: '#A39A88',
  track: '#EDE7DA',
  ringTrack: '#E3DCCD',
  lockedBg: '#F1ECE2',
  lockedBorder: '#CFC5B0',
  dimTile: '#F3EEE3',
  dimDash: '#D2C8B4',
  outline: '#D9CFBB',
  outlineText: '#6B4A2B',
  outlineHover: '#F3EDE1',
  bodyDark: '#4A463E',
  tagNeutralText: '#5A5346',

  primary: '#7FB547',
  primaryShadow: '#5E8F2E',
  primaryShadowOnDark: '#4A7522',
  primaryInk: '#1F3310',
  primaryText: '#4C7A22',
  primaryTint: '#EEF5E3',
  primaryTintText: '#3E6A17',
  primaryTintBody: '#3E5A22',

  forest: '#2F4A1E',
  forestShadow: '#1E3311',
  night: '#1E2619',
  camera: '#1A2316',
  cameraStripe: '#1E2A19',
  onDark: '#F4F8EC',
  onDarkMuted: '#BFCBB2',
  onDarkSoft: '#D5E0C8',
  onDarkTip: '#E3EBD8',
  xpOnDark: '#BDE38E',
  scanGreen: '#9FD266',
  scanChipText: '#C8EBA0',
  cameraLabel: '#8FA07E',
  tipIcon: '#FFD48A',

  warnBg: '#FFF1D6',
  warnBorder: '#F2CF8A',
  warnIcon: '#B26B00',
  warnTitle: '#5E3A00',
  warnText: '#6F4A10',

  streakBg: '#FFE7CF',
  streakText: '#8A4310',
  infoBg: '#E6EEF8',
  infoText: '#2D5482',
  questRareBg: '#E9EEF9',
  questHikeBg: '#FFF0DD',
  questHikeIcon: '#A2560F',

  danger: '#D9553B',
  dangerBg: '#FCE4DE',
  dangerBorder: '#F0A796',
  dangerTitle: '#7A1E0C',
  dangerText: '#8A3A28',
  trendDown: '#B0452E',

  badgeCard: '#F4EBD6',
  badgeCardShadow: '#C8B78F',
  legendText: '#8A6A1E',
  legendInk: '#4A3200',
  legendBadgeInk: '#3E2A00',
  black: '#000000',
  white: '#FFFFFF',
  rarityInk: '#1E1B16',
} as const;

export const rarity: Record<
  Rarity,
  { label: string; labelLower: string; plural: string; color: string; text: string; base: number; badgeInk: string }
> = {
  pospolity: { label: 'Pospolity', labelLower: 'pospolity', plural: 'pospolite', color: '#869A73', text: '#6E685C', base: 40, badgeInk: '#1F3310' },
  rzadki: { label: 'Rzadki', labelLower: 'rzadki', plural: 'rzadkie', color: '#2B99E7', text: '#0068B2', base: 120, badgeInk: '#0E2442' },
  epicki: { label: 'Epicki', labelLower: 'epicki', plural: 'epicki', color: '#A56CDE', text: '#7A41AF', base: 300, badgeInk: '#2A0D3A' },
  legendarny: { label: 'Legendarny', labelLower: 'legendarny', plural: 'legendy', color: '#EFA831', text: '#8A6A1E', base: 800, badgeInk: '#4A3200' },
};

export const RARITY_ORDER: Rarity[] = ['pospolity', 'rzadki', 'epicki', 'legendarny'];

/** Heatmapa gmin: 5 stopni (0 = najmniej). */
export const heat = ['#E9F2DC', '#C9E2A6', '#A5CF72', '#7FB547', '#5E8F2E'] as const;

export const medals = ['#EFA831', '#D9D4CA', '#E3B58C'] as const;
export const medalDefault = '#F1ECE2';

/** Stopnie osiągnięć: tło medalu (z rankingu gmin + platyna), ikona i tekst etykiety. */
export const tiers = {
  braz: { color: '#E3B58C', ink: '#5A3415', text: '#9A5B2A' },
  srebro: { color: '#D9D4CA', ink: '#3F3B33', text: '#6E685C' },
  zloto: { color: '#EFA831', ink: '#4A3200', text: '#8A6A1E' },
  platyna: { color: '#9FD7DE', ink: '#0F3A40', text: '#2C6B73' },
  /** Sekretne – fiolet „epickiego”. */
  sekret: { color: '#A56CDE', ink: '#2A0D3A', text: '#7A41AF' },
} as const;

/** Mapa okolicy (karta „Wykryto region”) – płaska, w paletach placeholderów. */
export const mapColors = {
  land: '#F1ECDF',
  /** Las: paski 135° jak placeholder „moss”, tylko nasycone. */
  forestA: '#CFE0B4',
  forestB: '#C5D9A6',
  water: '#C3DDF0',
  waterLine: '#9FC6E6',
  road: '#FFFFFF',
  roadCasing: '#DCD2BE',
  track: '#B09A74',
  boundary: '#6B4A2B',
  attributionBg: 'rgba(255,255,255,0.72)',
} as const;

/** Paski 135° placeholderów. */
export const stripes = {
  sand: { a: '#E6DCC6', b: '#DDD1B7', label: '#8A7C5E' },
  moss: { a: '#E3EDD3', b: '#D9E6C5', label: '#6A7A55' },
  hero: { a: '#D9E6C5', b: '#CFDDB8', label: '#5F7049' },
  dark: { a: '#3A4632', b: '#33402C', label: '#A8B898' },
  camera: { a: '#1A2316', b: '#1E2A19', label: '#8FA07E' },
  forestAvatar: { a: '#4A5F3A', b: '#425634', label: '#BFCBB2' },
} as const;
export type StripeVariant = keyof typeof stripes;

export const fonts = {
  baloo700: 'Baloo2_700Bold',
  baloo800: 'Baloo2_800ExtraBold',
  nunito400: 'NunitoSans_400Regular',
  nunito600: 'NunitoSans_600SemiBold',
  nunito600i: 'NunitoSans_600SemiBold_Italic',
  nunito700: 'NunitoSans_700Bold',
  nunito800: 'NunitoSans_800ExtraBold',
  icon: 'MaterialSymbolsRounded',
  iconFilled: 'MaterialSymbolsRoundedFilled',
  mono: 'Menlo',
} as const;
export type FontKey = Exclude<keyof typeof fonts, 'icon' | 'iconFilled'>;

/**
 * Wysokość linii „normal” z przeglądarki (metryki hhea/typo fontów, USE_TYPO_METRICS):
 * Baloo 2 = 1.602 em, Nunito Sans = 1.364 em. Ustawiamy ją jawnie w RN.
 */
export const lineHeightRatio: Record<FontKey, number> = {
  baloo700: 1.602,
  baloo800: 1.602,
  nunito400: 1.364,
  nunito600: 1.364,
  nunito600i: 1.364,
  nunito700: 1.364,
  nunito800: 1.364,
  mono: 1.2,
};

export const radii = {
  card: 22,
  cardLg: 26,
  sheet: 28,
  tile: 18,
  tileSm: 16,
  pill: 999,
  button: 22,
  buttonSm: 20,
  iconTile: 12,
  iconTileLg: 14,
} as const;

/** Twarde cienie „miękkiego cartoonu” (boxShadow – RN New Architecture + web). */
export const shadows = {
  card: '0px 2px 0px rgba(60,50,30,0.08)',
  photoButton: '0px 2px 0px rgba(0,0,0,0.1)',
  pill: '0px 3px 0px rgba(0,0,0,0.15)',
  rankBadge: '0px 3px 0px rgba(0,0,0,0.12)',
  forest: '0px 4px 0px #1E3311',
  forestSm: '0px 2px 0px #1E3311',
  tabBar: '0px -6px 20px rgba(60,50,30,0.08)',
  tooltip: '0px 4px 10px rgba(0,0,0,0.2)',
  knob: '0px 2px 4px rgba(0,0,0,0.2)',
  badgeCard: '0px 4px 0px #C8B78F',
  barInset: 'inset 0px -3px 0px rgba(0,0,0,0.12)',
  barInsetDark: 'inset 0px -3px 0px rgba(0,0,0,0.15)',
  badgeInset: 'inset 0px -4px 0px rgba(0,0,0,0.15)',
  selectedTile: '0px 0px 0px 3px #FFFFFF, 0px 0px 0px 6px #2E2B25',
  dialog: '0px 20px 40px rgba(46,43,37,0.25)',
} as const;

export const space = {
  screenX: 20,
  gap: 16,
} as const;

/** Wysokości z makiety (ramka 390×844). */
export const layout = {
  statusBar: 54,
  tabBarHeight: 92,
  tabScreenPaddingBottom: 110,
  screenPaddingBottom: 20,
} as const;
