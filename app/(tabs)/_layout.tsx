import { Tabs } from 'expo-router';

import { TabBar, type TabBarProps } from '@/components/TabBar';
import { colors } from '@/theme/tokens';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...(props as unknown as TabBarProps)} />}
      // freezeOnBlur: zakładki w tle nie przerysowują się przy zmianach GPS / wyprawy / store'ów – dogrywają stan
      // po powrocie. Logika działająca w tle (TripTracker, powiadomienia, gmina domowa z GPS) jest w app/_layout.tsx.
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg }, freezeOnBlur: true }}
    >
      <Tabs.Screen name="index" options={{ title: 'Wyprawa' }} />
      <Tabs.Screen name="gminy" options={{ title: 'Gminy' }} />
      <Tabs.Screen name="feed" options={{ title: 'Feed' }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil' }} />
    </Tabs>
  );
}
