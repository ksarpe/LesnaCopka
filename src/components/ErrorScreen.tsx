import { isLoaded } from 'expo-font';
import { router, type ErrorBoundaryProps } from 'expo-router';
import { useContext, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, type TextStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { DEV_TOOLS } from '@/config';
import { colors, fonts } from '@/theme/tokens';
import { reportError } from '@/utils/reportError';
import { ICON_CODEPOINTS } from './iconCodepoints';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, monospace' });

/** Krój z aplikacji, jeśli zdążył się wczytać – inaczej systemowy (błąd mógł wystąpić przed useFonts). */
function font(family: string, fallbackWeight: TextStyle['fontWeight']): TextStyle {
  let ok = false;
  try {
    ok = isLoaded(family);
  } catch {
    ok = false;
  }
  return ok ? { fontFamily: family } : { fontWeight: fallbackWeight };
}

/**
 * Ekran „Coś poszło nie tak” zamiast białego ekranu (ErrorBoundary w app/_layout.tsx – dla całego layoutu
 * i dla pojedynczych ekranów). Celowo bez store'ów, serwisów, Txt/Button3D i Reanimated: zależy tylko od RN,
 * tokenów kolorów i expo-router, bo błąd mógł wyjść właśnie z nich. Fonty i ikona – tylko gdy są wczytane.
 */
export function ErrorScreen({ error, retry }: ErrorBoundaryProps) {
  const insets = useContext(SafeAreaInsetsContext) ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    reportError(error, 'boundary');
  }, [error]);

  const again = () => {
    if (busy) return;
    setBusy(true);
    retry().finally(() => setBusy(false));
  };

  const goHome = () => {
    if (busy) return;
    try {
      // Zamknij modale i zastąp bieżący ekran startem; gdy padł cały layout (brak nawigatora), samo retry.
      if (router.canDismiss()) router.dismissAll();
      router.replace('/');
    } catch (e) {
      reportError(e, 'boundary.goHome');
    }
    again();
  };

  const title = font(fonts.baloo800, '800');
  const body = font(fonts.nunito600, '600');
  const strong = font(fonts.nunito800, '800');
  const iconOk = (() => {
    try {
      return isLoaded(fonts.iconFilled);
    } catch {
      return false;
    }
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 28,
          paddingTop: insets.top + 32,
          // Zapas na tab bar, gdy błąd złapał się w zakładce (ekran błędu jest wtedy pod paskiem).
          paddingBottom: insets.bottom + 110,
          gap: 18,
        }}
      >
        <View
          style={{
            width: 96,
            height: 96,
            borderRadius: 48,
            backgroundColor: colors.warnBg,
            borderWidth: 2,
            borderColor: colors.warnBorder,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {iconOk ? (
            <Text style={{ fontFamily: fonts.iconFilled, fontSize: 48, lineHeight: 48, color: colors.warnIcon }} accessible={false}>
              {String.fromCodePoint(ICON_CODEPOINTS.forest)}
            </Text>
          ) : (
            <Text style={{ fontSize: 44, fontWeight: '800', color: colors.warnIcon }}>!</Text>
          )}
        </View>

        <View style={{ gap: 8, alignItems: 'center', maxWidth: 360 }}>
          <Text accessibilityRole="header" style={[{ fontSize: 28, lineHeight: 36, color: colors.ink, textAlign: 'center' }, title]}>
            Coś poszło nie tak
          </Text>
          <Text style={[{ fontSize: 15, lineHeight: 21, color: colors.muted, textAlign: 'center' }, body]}>
            Ten ekran się nie wczytał. Twoje wyprawy i znaleziska są zapisane w telefonie – spróbuj ponownie albo wróć
            na start.
          </Text>
        </View>

        {DEV_TOOLS ? (
          <View style={{ alignSelf: 'stretch', backgroundColor: colors.canvas, borderRadius: 14, padding: 12, maxWidth: 480 }}>
            <Text selectable style={{ fontFamily: MONO, fontSize: 12, lineHeight: 16, color: colors.dangerTitle }}>
              {error.name}: {error.message}
            </Text>
          </View>
        ) : null}

        <View style={{ alignSelf: 'stretch', gap: 12, maxWidth: 420, marginTop: 6 }}>
          <Pressable onPress={again} disabled={busy} accessibilityRole="button" accessibilityLabel="Spróbuj ponownie">
            {({ pressed }) => (
              <View
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 22,
                  paddingVertical: 16,
                  alignItems: 'center',
                  boxShadow: pressed ? `0px 1px 0px ${colors.primaryShadow}` : `0px 4px 0px ${colors.primaryShadow}`,
                  transform: [{ translateY: pressed ? 3 : 0 }],
                  opacity: busy ? 0.7 : 1,
                }}
              >
                <Text style={[{ fontSize: 17, color: colors.primaryInk }, strong]}>Spróbuj ponownie</Text>
              </View>
            )}
          </Pressable>
          <Pressable onPress={goHome} disabled={busy} accessibilityRole="button" accessibilityLabel="Wróć na start">
            {({ pressed }) => (
              <View
                style={{
                  backgroundColor: pressed ? colors.outlineHover : colors.card,
                  borderRadius: 22,
                  borderWidth: 2,
                  borderColor: colors.outline,
                  paddingVertical: 14,
                  alignItems: 'center',
                }}
              >
                <Text style={[{ fontSize: 16, color: colors.outlineText }, strong]}>Wróć na start</Text>
              </View>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
