import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useUiStore } from '@/store/useUiStore';
import { colors, diamondGradient, shadows, tiers as tierTokens } from '@/theme/tokens';
import {
  formatProgress,
  TIER_LABEL,
  tierKind,
  type AchievementDef,
  type AchievementState,
} from '@/utils/achievements';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import { Txt } from './Txt';

/** Kolory medalu dla zdobytego stopnia (1-based); sekretne – fiolet. */
export function medalPalette(def: AchievementDef, tier: number) {
  if (def.secret) return tierTokens.sekret;
  return tierTokens[tierKind(def.tiers.length, Math.max(1, tier))];
}

/** Nazwa stopnia („Srebro”) – pusta dla osiągnięć jednostopniowych. */
export function tierName(def: AchievementDef, tier: number) {
  return def.tiers.length > 1 && tier > 0 ? TIER_LABEL[tierKind(def.tiers.length, tier)] : '';
}

const hidden = (s: { def: AchievementDef; tier: number }) => !!s.def.secret && s.tier === 0;

/** Okrągły medal jak odznaka; niezdobyty = przerywana ramka i wyszarzona ikona (sekret – „?”). */
export function AchievementMedal({ def, tier, size = 52 }: { def: AchievementDef; tier: number; size?: number }) {
  if (tier === 0) {
    return (
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.chip,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: colors.lockedBorder,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={def.secret ? 'question_mark' : def.icon} size={Math.round(size * 0.46)} color={colors.disabled} />
      </View>
    );
  }
  const p = medalPalette(def, tier);
  if (!def.secret && tierKind(def.tiers.length, tier) === 'diament') {
    return (
      <DiamondDisc size={size}>
        <Icon name={def.icon} filled size={Math.round(size * 0.5)} color={p.ink} />
      </DiamondDisc>
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: p.color,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: shadows.badgeInset,
      }}
    >
      <Icon name={def.icon} filled size={Math.round(size * 0.5)} color={p.ink} />
    </View>
  );
}

/**
 * Krążek „diamentowy”: lodowy gradient, chłodna obwódka, ukośny odblask i iskierka – bez animacji
 * (warstwy View + expo-linear-gradient). Też odznaka poziomu Lv 100+ w profilu.
 */
export function DiamondDisc({ size, children }: { size: number; children?: ReactNode }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        borderWidth: Math.max(1.5, size * 0.04),
        borderColor: diamondGradient.rim,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <LinearGradient
        pointerEvents="none"
        colors={diamondGradient.colors}
        locations={diamondGradient.locations}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: size * 0.1,
          left: size * 0.14,
          width: size * 0.44,
          height: size * 0.18,
          borderRadius: size * 0.09,
          backgroundColor: diamondGradient.shine,
          opacity: 0.6,
          transform: [{ rotate: '-30deg' }],
        }}
      />
      {children}
      {size >= 28 ? (
        <Icon
          name="auto_awesome"
          filled
          size={Math.round(size * 0.24)}
          color={colors.white}
          style={{ position: 'absolute', top: size * 0.05, right: size * 0.06, opacity: 0.9 }}
        />
      ) : null}
    </View>
  );
}

/** Kropki stopni: zdobyte w kolorze medalu z ciemniejszą obwódką (srebro na białym), pozostałe – sam kontur. */
function TierPips({ def, tier }: { def: AchievementDef; tier: number }) {
  if (def.tiers.length < 2) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {def.tiers.map((_, i) => {
        const p = tierTokens[tierKind(def.tiers.length, i + 1)];
        const earned = i < tier;
        return (
          <View
            key={i}
            style={{
              width: 9,
              height: 9,
              borderRadius: 4.5,
              borderWidth: 1.5,
              borderColor: earned ? p.text : colors.lockedBorder,
              backgroundColor: earned ? p.color : 'transparent',
            }}
          />
        );
      })}
    </View>
  );
}

/** Wiersz osiągnięcia: medal, nazwa + stopnie, cel następnego stopnia, pasek postępu, nagroda XP. */
export function AchievementRow({ state, onPress }: { state: AchievementState; onPress?: () => void }) {
  const { def, tier, next, done } = state;
  const secret = hidden(state);
  const label = tierName(def, tier);
  return (
    <Pressable
      onPress={onPress ?? (() => showAchievementDetails(state))}
      accessibilityRole="button"
      accessibilityLabel={secret ? 'Sekretne osiągnięcie' : `${def.name}${label ? `, ${label}` : ''}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.card,
        borderRadius: 20,
        paddingVertical: 12,
        paddingHorizontal: 14,
        boxShadow: shadows.card,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <AchievementMedal def={def} tier={tier} />
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt f="b7" size={16} lh={1.15} numberOfLines={1} color={tier === 0 ? colors.muted : colors.ink} style={{ flex: 1 }}>
            {secret ? '???' : def.name}
          </Txt>
          {done ? (
            <Icon name="check_circle" filled size={18} color={colors.primary} />
          ) : (
            <Txt f="n8" size={12} numberOfLines={1} color={colors.primaryText} style={{ flexShrink: 0 }}>
              +{next?.xp} XP
            </Txt>
          )}
        </View>
        <Txt f="n7" size={12} lh={1.25} color={colors.muted} numberOfLines={2}>
          {secret
            ? 'Sekretne osiągnięcie – odkryjesz je w lesie'
            : done
              ? `${label ? `${label} · ` : ''}${def.goal(def.tiers[def.tiers.length - 1].target)}`
              : def.goal(next!.target)}
        </Txt>
        {secret || (done && def.tiers.length < 2) ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TierPips def={def} tier={tier} />
            {done ? null : (
              <>
                <ProgressBar value={state.progress} height={8} inset={null} style={{ flex: 1 }} />
                <Txt f="n8" size={11} color={colors.muted} style={{ fontVariant: ['tabular-nums'] }}>
                  {formatProgress(state)}
                </Txt>
              </>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** Szczegóły: wszystkie stopnie z celami i nagrodami. */
export function showAchievementDetails(state: AchievementState) {
  const { def, tier } = state;
  if (hidden(state)) {
    useUiStore.getState().showDialog({
      title: 'Sekretne osiągnięcie',
      icon: 'question_mark',
      message: 'Warunek poznasz, gdy je zdobędziesz. Podpowiedź: rzadkie gatunki, nietypowe pory i uparte zbieranie.',
      actions: [{ label: 'OK', style: 'primary' }],
    });
    return;
  }
  // Krótkie linie (dialog jest wyśrodkowany): cel następnego stopnia, potem „✓ Brąz: 10 · +50 XP”.
  const fmt = def.format ?? ((v: number) => String(v));
  const goal = def.goal((state.next ?? def.tiers[def.tiers.length - 1]).target);
  const lines =
    def.tiers.length > 1
      ? def.tiers.map((t, i) => `${i < tier ? '✓' : '○'} ${tierName(def, i + 1)}: ${fmt(t.target)} · +${t.xp} XP`)
      : [`Nagroda: +${def.tiers[0].xp} XP`];
  const status = state.done ? 'Ukończone!' : `Postęp: ${formatProgress(state)}`;
  useUiStore.getState().showDialog({
    title: def.name,
    icon: def.icon,
    message: `${goal}\n\n${lines.join('\n')}\n\n${status}`,
    actions: [{ label: 'OK', style: 'primary' }],
  });
}
