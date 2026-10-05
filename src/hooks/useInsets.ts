import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout } from '@/theme/tokens';

/**
 * Górny odstęp treści. Makieta zakłada 54 px (ramka 390×844). Na iPhonie 15/16
 * safe-area wynosi 59 pt – odejmujemy 5 pt, żeby układ pokrywał się z plikiem
 * (treść i tak zaczyna się poniżej Dynamic Island). Android (edge-to-edge): pod paskiem
 * statusu + 8 px. Web: stałe 54 px.
 */
export function useTopInset() {
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'web') return layout.statusBar;
  if (Platform.OS === 'android') return insets.top + 8;
  return Math.max(insets.top - 5, 20);
}

/**
 * Wysokość tab bara: 92 px z makiety (= 58 px treści + 34 px home indicatora iPhone'a).
 * Na Androidzie z 3-przyciskową nawigacją rośnie, żeby ikony nie wchodziły pod przyciski systemu.
 */
export function useTabBarHeight() {
  const insets = useSafeAreaInsets();
  return Math.max(layout.tabBarHeight, layout.tabBarHeight - 34 + insets.bottom);
}

/** Dolny odstęp ekranu bez tab bara: 20 px z makiety; na Androidzie nad paskiem nawigacji systemu. */
export function useBottomPadding(base: number = layout.screenPaddingBottom) {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== 'android') return base;
  return Math.max(base, insets.bottom + 12);
}
