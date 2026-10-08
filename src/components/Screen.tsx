import { StatusBar } from 'expo-status-bar';
import type { ReactElement, ReactNode } from 'react';
import { ScrollView, View, type RefreshControlProps, type StyleProp, type ViewStyle } from 'react-native';

import { useBottomPadding, useTabBarHeight, useTopInset } from '@/hooks/useInsets';
import { colors, layout } from '@/theme/tokens';
import { UiHost } from './UiHost';

interface ScreenProps {
  children: ReactNode;
  bg?: string;
  /** Ekran z tab barem: padding dolny 110 px (jak `pb` w makiecie). */
  tabs?: boolean;
  /** Hero na całą szerokość od samej góry (Analiza, Gmina): bez górnego odstępu. */
  hero?: boolean;
  scroll?: boolean;
  /**
   * Treścią jest lista (FlatList / SectionList): bez ScrollView i bez odstępów – lista dokłada je w
   * `contentContainerStyle` (useScreenPadding), więc przewija się pod paskiem statusu jak ScrollView ekranu.
   */
  list?: boolean;
  statusBar?: 'dark' | 'light';
  refreshControl?: ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Dodatkowe elementy nad treścią (np. przyklejony pasek). */
  overlay?: ReactNode;
  /** Odstęp toastu od dołu – np. nad przyklejonymi przyciskami ekranu (domyślnie nad tab barem / krawędzią). */
  toastBottom?: number;
}

/** Odstępy treści ekranu: górny (pod paskiem statusu) i dolny (nad tab barem albo krawędzią ekranu). */
export function useScreenPadding(tabs?: boolean) {
  const top = useTopInset();
  const tabBar = useTabBarHeight();
  const bottom = useBottomPadding();
  // 110 px w makiecie = tab bar 92 + 18.
  return { top, bottom: tabs ? tabBar + (layout.tabScreenPaddingBottom - layout.tabBarHeight) : bottom, tabBar };
}

/** Wspólne ustawienia list ekranów (`<Screen list>`) – te same co ScrollView ekranu. */
export const SCREEN_LIST_PROPS = {
  showsVerticalScrollIndicator: false,
  // Odstępy liczymy sami (useTopInset) – iOS nie dokłada własnych insetów.
  contentInsetAdjustmentBehavior: 'never',
  automaticallyAdjustContentInsets: false,
  keyboardShouldPersistTaps: 'handled',
} as const;

export function Screen({
  children,
  bg = colors.bg,
  tabs,
  hero,
  scroll = true,
  list,
  statusBar = 'dark',
  refreshControl,
  contentStyle,
  overlay,
  toastBottom,
}: ScreenProps) {
  const { top, bottom: pb, tabBar } = useScreenPadding(tabs);
  const bottom = useBottomPadding();
  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <StatusBar style={statusBar} />
      {list ? (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      ) : scroll ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[{ paddingTop: hero ? 0 : top, paddingBottom: pb }, contentStyle]}
          refreshControl={refreshControl}
          {...SCREEN_LIST_PROPS}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, paddingTop: hero ? 0 : top }, contentStyle]}>{children}</View>
      )}
      {overlay}
      <UiHost toastBottom={toastBottom ?? (tabs ? tabBar + 24 : bottom + 20)} />
    </View>
  );
}
