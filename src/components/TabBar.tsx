import { router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { useTabBarHeight } from '@/hooks/useInsets';
import { colors, shadows } from '@/theme/tokens';
import { Press3D } from './Button3D';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

type Route = { key: string; name: string; state?: { index?: number; routes?: { name: string }[] } };

export interface TabBarProps {
  state: { index: number; routes: Route[] };
  navigation: { navigate: (name: string) => void; emit: (e: { type: 'tabPress'; target: string; canPreventDefault: true }) => { defaultPrevented: boolean } };
}

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Wyprawa', icon: 'forest' },
  gminy: { label: 'Gminy', icon: 'map' },
  feed: { label: 'Feed', icon: 'dynamic_feed' },
  profil: { label: 'Profil', icon: 'person' },
};
const ORDER = ['index', 'gminy', 'SCAN', 'feed', 'profil'];

/**
 * Własny tab bar: biały, 92 px, górne rogi 28, cień w górę; środkowy FAB 66 px
 * podniesiony o 30 px z białym ringiem 6 px → Skan.
 */
export function TabBar({ state, navigation }: TabBarProps) {
  const height = useTabBarHeight();
  const focused = state.routes[state.index];
  // Szczegóły gminy (07) są bez tab bara – jak w makiecie.
  const nested = focused.state;
  const nestedRoute = nested?.routes?.[nested.index ?? 0];
  if (focused.name === 'gminy' && nestedRoute && nestedRoute.name !== 'index') return null;

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height,
        backgroundColor: colors.card,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        boxShadow: shadows.tabBar,
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingTop: 10,
        zIndex: 4,
      }}
    >
      {ORDER.map((name) => {
        if (name === 'SCAN') {
          return (
            <View key="scan" style={{ flex: 1, alignItems: 'center' }}>
              <Press3D
                onPress={() => router.push('/scan')}
                depth={5}
                pressDepth={4}
                shadowColor={colors.primaryShadow}
                radius={33}
                ring={{ width: 6, color: colors.white }}
                style={{ marginTop: -30 }}
                accessibilityLabel="Skanuj grzyba"
                faceStyle={{
                  width: 66,
                  height: 66,
                  backgroundColor: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="center_focus_strong" filled size={32} color={colors.primaryInk} />
              </Press3D>
            </View>
          );
        }
        const route = state.routes.find((r) => r.name === name);
        if (!route) return <View key={name} style={{ flex: 1 }} />;
        const active = focused.key === route.key;
        const color = active ? colors.primaryText : colors.faint;
        const t = TABS[name];
        return (
          <Pressable
            key={name}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.label}
            onPress={() => {
              const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!e.defaultPrevented) {
                if (active && name === 'gminy') router.navigate('/gminy');
                else navigation.navigate(route.name);
              }
            }}
            style={{ flex: 1, alignItems: 'center', gap: 2 }}
          >
            <Icon name={t.icon} filled size={26} color={color} />
            <Txt f="n8" size={11} color={color}>
              {t.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
