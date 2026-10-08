import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Spin3D, type Spin3DTilt } from '@/components/Spin3D';
import { Txt } from '@/components/Txt';
import { useBottomPadding, useTopInset } from '@/hooks/useInsets';
import { hasSpin } from '@/scan/views';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useTripStore } from '@/store/useTripStore';
import { colors } from '@/theme/tokens';
import { plural } from '@/utils/format';

/** Ujęcia z aparatu są pionowe (3 : 4). */
const ASPECT = 4 / 3;

const TILTS: { v: Spin3DTilt; label: string; icon: IconName; kind: 'low' | 'side' | 'top' }[] = [
  { v: -1, label: 'Od spodu', icon: 'expand_more', kind: 'low' },
  { v: 0, label: 'Z boku', icon: '3d_rotation', kind: 'side' },
  { v: 1, label: 'Z góry', icon: 'expand_less', kind: 'top' },
];

/**
 * Podgląd 3D znaleziska na pełnym ekranie: grzyb z ujęć skanu 3D – przeciąganie w bok obraca, w górę i w dół
 * przechyla na ujęcie z góry / od spodu (też przyciskami pod spodem). Ujęcia są tylko w telefonie (Find.views).
 */
export default function Preview3DScreen() {
  const { findId } = useLocalSearchParams<{ findId: string }>();
  const find = useTripStore((s) => s.finds[findId]);
  const species = useCatalogStore((s) => (find ? s.speciesById[find.speciesId] : undefined));
  const top = useTopInset();
  const bottom = useBottomPadding(24);
  const { width, height } = useWindowDimensions();
  const [tilt, setTilt] = useState<Spin3DTilt>(0);

  const views = find?.views ?? [];
  const spin = hasSpin(views);
  const w = Math.min(width - 32, 520);
  const h = Math.max(240, Math.min(w * ASPECT, height - top - bottom - 230));
  const tilts = TILTS.filter((t) => t.kind === 'side' || views.some((v) => v.kind === t.kind));

  return (
    <View style={{ flex: 1, backgroundColor: colors.camera, paddingTop: top + 8, paddingBottom: bottom, gap: 18 }}>
      <StatusBar style="light" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20 }}>
        <IconButton icon="close" variant="dark" onPress={() => router.back()} accessibilityLabel="Zamknij podgląd 3D" />
        <View style={{ flex: 1 }}>
          <Txt f="b7" size={20} color={colors.onDark} numberOfLines={1}>
            {species?.name ?? 'Podgląd 3D'}
          </Txt>
          <Txt f="n7" size={13} color={colors.onDarkSoft}>
            {spin ? `Skan 3D · ${views.length} ${plural(views.length, 'ujęcie', 'ujęcia', 'ujęć')}` : 'Skan 3D'}
          </Txt>
        </View>
      </View>

      {spin ? (
        <>
          <Spin3D
            views={views}
            tilt
            tiltTo={tilt}
            onTiltChange={setTilt}
            spinMs={16_000}
            style={{ width: w, height: h, borderRadius: 28, alignSelf: 'center', backgroundColor: colors.cameraStripe }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 }}>
            <Icon name="swipe" size={18} color={colors.onDarkMuted} />
            <Txt f="n7" size={13} color={colors.onDarkMuted} align="center" style={{ flexShrink: 1 }}>
              {tilts.length > 1 ? 'Przeciągnij w bok, by obrócić; w górę i w dół – inne ujęcia' : 'Przeciągnij w bok, by obrócić'}
            </Txt>
          </View>
          {tilts.length > 1 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }} accessibilityRole="tablist">
              {tilts.map((t) => {
                const on = tilt === t.v;
                return (
                  <Pressable
                    key={t.v}
                    onPress={() => setTilt(t.v)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: 9,
                      paddingHorizontal: 14,
                      borderRadius: 999,
                      backgroundColor: on ? colors.scanGreen : 'rgba(255,255,255,0.12)',
                    }}
                  >
                    <Icon name={t.icon} size={18} color={on ? colors.primaryInk : colors.onDark} />
                    <Txt f="n8" size={14} color={on ? colors.primaryInk : colors.onDark}>
                      {t.label}
                    </Txt>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 }}>
          <Icon name="view_in_ar" size={44} color={colors.onDarkMuted} />
          <Txt f="b7" size={20} color={colors.onDark} align="center">
            Brak podglądu 3D
          </Txt>
          <Txt f="n6" size={14} color={colors.onDarkSoft} align="center">
            To znalezisko nie ma ujęć ze skanu 3D – albo zostały na innym telefonie.
          </Txt>
        </View>
      )}
    </View>
  );
}
