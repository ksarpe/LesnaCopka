import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTopInset } from '@/hooks/useInsets';
import { colors, shadows } from '@/theme/tokens';
import type { Edibility, Lookalike, Rarity, Species, SpeciesPercentile } from '@/types';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { Pill, RarityPill } from './Pill';
import { Placeholder } from './Placeholder';
import { Bone } from './Skeleton';
import { StatTile } from './StatTile';
import { Txt } from './Txt';

export const EDIBILITY_LABEL: Record<Edibility, string> = {
  jadalny: 'Jadalny',
  niejadalny: 'Niejadalny',
  trujacy: 'Trujący',
  smiertelny: 'Śmiertelnie trujący',
};

export function isPoisonous(e: Edibility) {
  return e === 'trujacy' || e === 'smiertelny';
}

/** Zdjęcie 320 px z przyciskiem wstecz, pigułką pewności i rzadkości. */
export function SpeciesHero({
  rarity,
  onBack,
  confidence,
  label = 'zdjęcie ze skanu (model 3D)',
  lowConfidence,
}: {
  rarity: Rarity;
  onBack: () => void;
  confidence?: number;
  label?: string;
  lowConfidence?: boolean;
}) {
  const top = useTopInset();
  return (
    <Placeholder variant="sand" stripe={12} label={label} style={{ height: 320 }}>
      <IconButton
        icon="arrow_back"
        variant="photo"
        onPress={onBack}
        accessibilityLabel="Wstecz"
        style={{ position: 'absolute', left: 20, top: top + 8 }}
      />
      {confidence != null ? (
        <Pill
          label={`Pewność ${Math.round(confidence * 100)}%`}
          icon={lowConfidence ? 'help' : 'verified'}
          iconColor={lowConfidence ? colors.warnIcon : colors.primaryText}
          bg={lowConfidence ? colors.warnBg : colors.white}
          color={lowConfidence ? colors.warnTitle : colors.ink}
          padV={7}
          padH={12}
          style={{ position: 'absolute', right: 20, top: top + 12 }}
        />
      ) : null}
      {!lowConfidence ? <RarityPill rarity={rarity} style={{ position: 'absolute', left: 20, bottom: 40 }} /> : null}
    </Placeholder>
  );
}

/** Arkusz nachodzący na zdjęcie: marginTop -24, górne rogi 28. */
export function Sheet({ children, overlap = 24 }: { children: ReactNode; overlap?: number }) {
  return (
    <View
      style={{
        marginTop: -overlap,
        backgroundColor: colors.bg,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        paddingTop: 22,
        paddingHorizontal: 20,
        paddingBottom: 20,
        gap: 16,
      }}
    >
      {children}
    </View>
  );
}

export function SpeciesTitle({ species }: { species: Species }) {
  return (
    <View style={{ gap: 2 }}>
      <Txt f="b7" size={30} lh={1.1}>
        {species.name}
      </Txt>
      <Txt f="n6i" size={15} color={colors.muted}>
        {species.latin}
      </Txt>
    </View>
  );
}

export function SpeciesTags({ species, xxl }: { species: Species; xxl?: boolean }) {
  const e = species.edibility;
  const poison = isPoisonous(e);
  return (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      <Pill
        label={EDIBILITY_LABEL[e]}
        padH={11}
        bg={poison ? colors.dangerBg : e === 'jadalny' ? colors.primaryTint : colors.canvas}
        color={poison ? colors.dangerTitle : e === 'jadalny' ? colors.primaryTintText : colors.tagNeutralText}
      />
      {xxl ? <Pill label="Okaz XXL" padH={11} bg={colors.streakBg} color={colors.streakText} /> : null}
      <Pill label={species.habitat} padH={11} bg={colors.canvas} color={colors.tagNeutralText} />
    </View>
  );
}

const EDIBILITY_SHORT: Record<Edibility, string> = {
  jadalny: 'jadalny',
  niejadalny: 'niejadalny',
  trujacy: 'trujący',
  smiertelny: 'śmiertelnie trujący',
};

/** Żółty baner bezpieczeństwa – zawsze, gdy gatunek ma sobowtóra. */
export function SafetyBanner({ lookalike }: { lookalike: Lookalike }) {
  return (
    <Banner
      icon="warning"
      bg={colors.warnBg}
      border={colors.warnBorder}
      iconColor={colors.warnIcon}
      title="Potwierdź u eksperta przed jedzeniem"
      titleColor={colors.warnTitle}
      text={`Sobowtór: ${lookalike.name} (${EDIBILITY_SHORT[lookalike.edibility]}). ${lookalike.tip}`}
      textColor={colors.warnText}
    />
  );
}

/** Czerwony baner dla gatunków trujących. */
export function PoisonBanner({ deadly }: { deadly: boolean }) {
  return (
    <Banner
      icon="dangerous"
      bg={colors.dangerBg}
      border={colors.dangerBorder}
      iconColor={colors.danger}
      title="Nie zbieraj – tylko zdjęcie"
      titleColor={colors.dangerTitle}
      text={
        deadly
          ? 'Gatunek śmiertelnie trujący. Nie dotykaj gołymi rękami i nie wkładaj do koszyka – zapisz go tylko w atlasie.'
          : 'Gatunek trujący. Zostaw go w lesie – zdjęcie trafi do atlasu, ale nie do koszyka.'
      }
      textColor={colors.dangerText}
    />
  );
}

function Banner(p: {
  icon: IconName;
  bg: string;
  border: string;
  iconColor: string;
  title: string;
  titleColor: string;
  text: string;
  textColor: string;
}) {
  return (
    <View
      style={{
        backgroundColor: p.bg,
        borderWidth: 2,
        borderColor: p.border,
        borderRadius: 20,
        padding: 14,
        flexDirection: 'row',
        gap: 12,
      }}
    >
      <Icon name={p.icon} filled size={26} color={p.iconColor} />
      <View style={{ flex: 1, gap: 4 }}>
        <Txt f="n8" size={14} color={p.titleColor}>
          {p.title}
        </Txt>
        <Txt f="n6" size={13} color={p.textColor}>
          {p.text}
        </Txt>
      </View>
    </View>
  );
}

export function StatGrid({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={{ gap: 10 }}>
      {[0, 2].map((row) => (
        <View key={row} style={{ flexDirection: 'row', gap: 10 }}>
          {items.slice(row, row + 2).map((it) => (
            <StatTile key={it.label} label={it.label} value={it.value} labelFirst valueSize={24} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Karta „W gminie X w tym sezonie” ze skalą percentyla. */
export function GminaSeasonCard({
  gminaName,
  data,
  loading,
  error,
}: {
  gminaName: string;
  data?: SpeciesPercentile;
  loading: boolean;
  error?: boolean;
}) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 22, padding: 16, gap: 12, boxShadow: shadows.card }}>
      <Txt f="b7" size={18}>
        W gminie {gminaName} w tym sezonie
      </Txt>
      {error ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Icon name="wifi_off" size={18} color={colors.muted} />
          <Txt f="n7" size={13} color={colors.muted} style={{ flex: 1 }}>
            Statystyki gminy będą dostępne, gdy wróci zasięg.
          </Txt>
        </View>
      ) : loading || !data ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Bone w={56} h={30} />
            <Bone w={56} h={30} />
            <Bone w={56} h={30} />
          </View>
          <Bone w="100%" h={12} r={6} />
          <Bone w="60%" h={13} />
        </View>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <MiniStat value={String(data.collected)} label="zebranych" />
            <MiniStat value={String(data.mushroomers)} label="grzybiarzy" />
            <MiniStat value={`#${data.sizeRank}`} label="największy" />
          </View>
          <View style={{ gap: 6 }}>
            <View style={{ height: 12 }}>
              <LinearGradient
                colors={[colors.track, '#C9E2A6']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={{ height: 12, borderRadius: 999 }}
              />
              <View
                style={{
                  position: 'absolute',
                  left: `${data.percentile}%`,
                  top: -5,
                  marginLeft: -11,
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: colors.primary,
                  borderWidth: 3,
                  borderColor: colors.white,
                  boxShadow: shadows.knob,
                }}
              />
            </View>
            <Txt f="n7" size={13} color={colors.primaryText}>
              Większy niż {data.percentile}% okazów w gminie
            </Txt>
          </View>
        </>
      )}
    </View>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <View>
      <Txt f="b7" size={22}>
        {value}
      </Txt>
      <Txt f="n7" size={12} color={colors.muted}>
        {label}
      </Txt>
    </View>
  );
}
