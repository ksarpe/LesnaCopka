import { Baloo2_700Bold, Baloo2_800ExtraBold } from '@expo-google-fonts/baloo-2';
import {
  NunitoSans_400Regular,
  NunitoSans_600SemiBold,
  NunitoSans_600SemiBold_Italic,
  NunitoSans_700Bold,
  NunitoSans_800ExtraBold,
} from '@expo-google-fonts/nunito-sans';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorScreen } from '@/components/ErrorScreen';
import { HomeGminaFromGps } from '@/components/HomeGminaFromGps';
import { NotificationsHost } from '@/components/NotificationsHost';
import { TripTracker } from '@/components/TripTracker';
import { applyDevLink } from '@/dev/devLinks';
import { missingGminy } from '@/geo';
import { ServicesProvider, useServices } from '@/services';
import { ensureDailyReset } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useTripStore } from '@/store/useTripStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, mapColors } from '@/theme/tokens';
import { installGlobalErrorHandlers } from '@/utils/reportError';

SplashScreen.preventAutoHideAsync().catch(() => {});
// Wydanie: globalne błędy JS i nieobsłużone odrzucenia obietnic → reportError (w dev pokazuje je LogBox).
installGlobalErrorHandlers();

export const unstable_settings = {
  anchor: '(tabs)',
};

/**
 * Błąd renderowania → ekran „Coś poszło nie tak” zamiast białego ekranu (konwencja expo-router).
 * Łapie błędy całego layoutu (start, fonty, store'y); błędy pojedynczych ekranów łapie ten sam komponent
 * podpięty pod Stack (`unstable_screenErrorBoundary`) – nawigacja zostaje wtedy żywa i „Wróć na start” działa.
 */
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <ErrorScreen {...props} />;
}

function useStoresHydrated() {
  const stores = [useUserStore, useTripStore, useSimStore];
  const [hydrated, setHydrated] = useState(() => stores.every((s) => s.persist.hasHydrated()));
  useEffect(() => {
    const check = () => setHydrated(stores.every((s) => s.persist.hasHydrated()));
    const unsubs = stores.map((s) => s.persist.onFinishHydration(check));
    check();
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return hydrated;
}

function AppStack() {
  const services = useServices();
  const ready = useCatalogStore((s) => s.ready);
  const hydrated = useStoresHydrated();
  // Onboarding (pierwsze uruchomienie, nowe konto): dopóki nie skończony, zakładki i reszta ekranów są niedostępne.
  const onboarded = useUserStore((s) => s.onboarded);
  const [fontsLoaded] = useFonts({
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_600SemiBold_Italic,
    NunitoSans_700Bold,
    NunitoSans_800ExtraBold,
    MaterialSymbolsRounded: require('../assets/fonts/MaterialSymbolsRounded.ttf'),
    MaterialSymbolsRoundedFilled: require('../assets/fonts/MaterialSymbolsRoundedFilled.ttf'),
  });

  useEffect(() => {
    services.init().then(() => useCatalogStore.getState().load(services.catalog));
  }, [services]);

  // Wyprawy, znaleziska i gmina domowa z gmin spoza danych gry (GPS / Ustawienia) – nazwy z indeksu PRG po restarcie.
  useEffect(() => {
    if (!ready || !hydrated) return;
    const { trips, finds } = useTripStore.getState();
    const ids = [
      useUserStore.getState().user.homeGminaId,
      // Obserwowane gminy z innych województw (ranking na ekranie Gminy).
      ...useUserStore.getState().followedGminy,
      ...Object.values(trips).map((x) => x.gminaId),
      ...Object.values(finds).map((x) => x.gminaId),
    ];
    missingGminy(ids, useCatalogStore.getState().gminaById)
      .then((list) => list.forEach((g) => useCatalogStore.getState().upsertGmina(g)))
      .catch(() => {});
  }, [ready, hydrated]);

  const all = fontsLoaded && ready && hydrated;
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    if (!all) return;
    ensureDailyReset();
    if (__DEV__ && Platform.OS === 'web' && typeof window !== 'undefined') {
      // Część synchroniczna (stan) wykonuje się przed pierwszym renderem ekranów.
      applyDevLink(new URLSearchParams(window.location.search), services);
    }
    // Jednorazowy „boot” po hydratacji store'ów i wczytaniu fontów.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBooted(true);
    SplashScreen.hideAsync().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  if (!all || !booted) return null;

  return (
    <>
      {/*
        Wszystko, co ma działać niezależnie od widocznego ekranu (śledzenie wyprawy, powiadomienia, gmina domowa z GPS),
        żyje tutaj – ekrany pod innymi są zamrażane (freezeOnBlur) i nie przerysowują się, dopóki nie wrócą na wierzch.
      */}
      <TripTracker />
      <NotificationsHost />
      {onboarded ? <HomeGminaFromGps /> : null}
      {/*
        Stack.Protected: przy `onboarded = false` dostępny jest tylko onboarding (pierwszy na liście – na niego trafia
        nawigacja) oraz dokumenty prawne i panel /dev. Zmiana flagi sama przełącza ekrany (bez „wstecz” do zakładek).
        Nowy ekran aplikacji dopisz do grupy `guard={onboarded}` – inaczej byłby dostępny także w trakcie onboardingu.
        freezeOnBlur: ekrany przykryte innymi nie reagują na zmiany store'ów (GPS, wyprawa) – na nowej architekturze
        react-native-screens zamraża dopiero ekran o dwa poziomy pod bieżącym (bezpośrednio niższy zostaje żywy na
        czas animacji powrotu). Ekrany skanu (skan → analiza → nagroda) bez zamrażania – ich przepływ trzyma stan
        między sobą.
      */}
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, freezeOnBlur: true }}
        unstable_screenErrorBoundary={ErrorBoundary}
      >
        <Stack.Protected guard={!onboarded}>
          <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
        </Stack.Protected>
        <Stack.Protected guard={onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="scan"
            options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: colors.camera }, freezeOnBlur: false }}
          />
          <Stack.Screen name="analysis/[findId]" options={{ freezeOnBlur: false }} />
          <Stack.Screen
            name="podglad3d/[findId]"
            options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: colors.camera } }}
          />
          <Stack.Screen
            name="reward/[findId]"
            options={{
              presentation: 'fullScreenModal',
              animation: 'fade',
              gestureEnabled: false,
              contentStyle: { backgroundColor: colors.night },
              freezeOnBlur: false,
            }}
          />
          <Stack.Screen
            name="mapa"
            options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: mapColors.land } }}
          />
          <Stack.Screen name="summary/[tripId]" options={{ gestureEnabled: false }} />
          <Stack.Screen name="species/[speciesId]" />
          <Stack.Screen name="atlas" />
          <Stack.Screen name="osiagniecia" />
          <Stack.Screen name="wyprawy" />
          <Stack.Screen name="znaleziska" />
          <Stack.Screen name="komentarze/[postId]" />
          <Stack.Screen name="powiadomienia" />
          <Stack.Screen name="znajomi" />
          <Stack.Screen name="zaproszenie/[handle]" />
          <Stack.Screen name="ustawienia/index" />
          <Stack.Screen name="ustawienia/profil" />
          <Stack.Screen name="ustawienia/gmina" />
          <Stack.Screen name="ustawienia/powiadomienia" />
          <Stack.Screen name="ustawienia/konto" />
          <Stack.Screen name="ustawienia/zablokowani" />
          <Stack.Screen name="ustawienia/usun-konto" />
          <Stack.Screen name="ustawienia/mapy-offline" />
        </Stack.Protected>
        {/* Zawsze dostępne: dokumenty prawne (link z onboardingu) i panel /dev. */}
        <Stack.Screen name="ustawienia/regulamin" />
        <Stack.Screen name="ustawienia/prywatnosc" />
        <Stack.Screen name="dev" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <ServicesProvider>
          <AppStack />
        </ServicesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
