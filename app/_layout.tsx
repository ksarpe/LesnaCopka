import { Baloo2_700Bold, Baloo2_800ExtraBold } from '@expo-google-fonts/baloo-2';
import {
  NunitoSans_400Regular,
  NunitoSans_600SemiBold,
  NunitoSans_600SemiBold_Italic,
  NunitoSans_700Bold,
  NunitoSans_800ExtraBold,
} from '@expo-google-fonts/nunito-sans';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { TripTracker } from '@/components/TripTracker';
import { applyDevLink } from '@/dev/devLinks';
import { missingGminy } from '@/geo';
import { ServicesProvider, useServices } from '@/services';
import { ensureDailyReset } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useTripStore } from '@/store/useTripStore';
import { useUserStore } from '@/store/useUserStore';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  anchor: '(tabs)',
};

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

  // Wyprawy i znaleziska z gmin spoza danych gry (wykryte z GPS) – nazwy z indeksu PRG po restarcie.
  useEffect(() => {
    if (!ready || !hydrated) return;
    const { trips, finds } = useTripStore.getState();
    const ids = [...Object.values(trips).map((x) => x.gminaId), ...Object.values(finds).map((x) => x.gminaId)];
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
      <TripTracker />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="scan"
          options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: colors.camera } }}
        />
        <Stack.Screen name="analysis/[findId]" />
        <Stack.Screen
          name="reward/[findId]"
          options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: colors.night } }}
        />
        <Stack.Screen name="summary/[tripId]" options={{ gestureEnabled: false }} />
        <Stack.Screen name="species/[speciesId]" />
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
