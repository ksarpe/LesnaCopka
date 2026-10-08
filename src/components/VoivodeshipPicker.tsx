import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DEV_TOOLS } from '@/config';
import { gminaIndex } from '@/geo';
import { DESIGN_VOIVODESHIP, gminyOf, VOIVODESHIPS } from '@/geo/voivodeships';
import { useAsync } from '@/hooks/useAsync';
import { colors, shadows } from '@/theme/tokens';
import { plural } from '@/utils/format';
import { Icon } from './Icon';
import { Txt } from './Txt';

interface VoivodeshipPickerProps {
  visible: boolean;
  /** Aktualnie pokazywane województwo. */
  value: string;
  /** Ręcznie wybrane (null = automatycznie wg lokalizacji). */
  picked: string | null;
  /** Województwo wykrytej gminy (null = brak lokalizacji). */
  detected: string | null;
  onPick: (v: string | null) => void;
  onClose: () => void;
}

/** Arkusz od dołu z 16 województwami (+ „tam, gdzie jesteś”, gdy znamy lokalizację). */
export function VoivodeshipPicker({ visible, value, picked, detected, onPick, onClose }: VoivodeshipPickerProps) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const counts = useAsync(async () => {
    const index = await gminaIndex();
    return Object.fromEntries(VOIVODESHIPS.map((v) => [v.name, gminyOf(index, v.name).length]));
  }, []);

  const choose = (v: string | null) => {
    onPick(v);
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij wybór województwa" />
          <Animated.View
            entering={SlideInDown.duration(240)}
            style={[styles.sheet, { maxHeight: Math.round(height * 0.82), paddingBottom: Math.max(insets.bottom, 16) }]}
          >
            <View style={styles.grabber} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 }}>
              <View style={{ flex: 1 }}>
                <Txt f="b7" size={24}>
                  Województwo
                </Txt>
                <Txt f="n7" size={13} color={colors.muted}>
                  Ranking i mapa gmin regionu
                </Txt>
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Zamknij">
                <Icon name="close" size={24} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4, gap: 8 }}>
              {detected ? (
                <Row
                  title="Tam, gdzie jesteś"
                  sub={detected}
                  icon="my_location"
                  selected={picked == null}
                  onPress={() => choose(null)}
                />
              ) : null}
              {VOIVODESHIPS.map((v) => {
                const n = counts.data?.[v.name];
                return (
                  <Row
                    key={v.teryt}
                    title={v.name}
                    sub={
                      n == null
                        ? ' '
                        : // Dopisek o danych z makiety tylko w buildach z narzędziami dev (gracz nie wie, czym jest „makieta”).
                          `${n} ${plural(n, 'gmina', 'gminy', 'gmin')}${DEV_TOOLS && v.name === DESIGN_VOIVODESHIP ? ' · mapa cieplna z makiety' : ''}`
                    }
                    selected={picked != null ? v.name === picked : !detected && v.name === value}
                    here={v.name === detected}
                    onPress={() => choose(v.name)}
                  />
                );
              })}
            </ScrollView>
          </Animated.View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

function Row({
  title,
  sub,
  icon,
  selected,
  here,
  onPress,
}: {
  title: string;
  sub: string;
  icon?: 'my_location';
  selected: boolean;
  here?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => ({
        backgroundColor: pressed ? '#FDFBF6' : colors.card,
        borderRadius: 18,
        paddingVertical: 10,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        boxShadow: shadows.card,
        borderWidth: 2.5,
        borderColor: selected ? colors.primary : 'transparent',
      })}
    >
      {icon ? (
        <View style={styles.iconTile}>
          <Icon name={icon} size={20} color={colors.primaryText} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={15}>
          {title}
        </Txt>
        <Txt f="n7" size={12} color={colors.muted}>
          {sub}
        </Txt>
      </View>
      {here && !icon ? <Icon name="my_location" size={18} color={colors.primaryText} /> : null}
      {selected ? <Icon name="check_circle" filled size={22} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(30,27,22,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    gap: 4,
    boxShadow: shadows.dialog,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.outline, marginBottom: 8 },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
