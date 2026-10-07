import { router, type Href } from 'expo-router';
import { View } from 'react-native';

import { GminaPicker, type GminaOption } from '@/components/GminaPicker';
import { IconButton } from '@/components/IconButton';
import { Screen } from '@/components/Screen';
import { Txt } from '@/components/Txt';
import { syncProfile } from '@/services/supabase/profile';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors } from '@/theme/tokens';

/** Wybór gminy domowej (Ustawienia → Konto): gminy z danymi gry + wyszukiwarka wszystkich 2479 gmin (GminaPicker). */
export default function HomeGminaScreen() {
  const homeId = useUserStore((s) => s.user.homeGminaId);

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/ustawienia' as Href));

  const choose = (o: GminaOption) => {
    if (o.id !== homeId) {
      const u = useUserStore.getState();
      u.patch({ user: { ...u.user, homeGminaId: o.id } });
      void syncProfile({ homeGminaId: o.id });
      ui.toast(`Gmina domowa: ${o.title}`, 'home_pin');
    }
    back();
  };

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Gmina domowa
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <Txt f="n6" size={14} color={colors.muted}>
          Twoja drużyna w rankingu gmin – na nią liczymy porównania okazów i pokazujemy feed „Gmina”. Wyprawa i tak zapisuje
          się w gminie, w której faktycznie jesteś.
        </Txt>

        <GminaPicker selectedId={homeId} onSelect={choose} />
      </View>
    </Screen>
  );
}
