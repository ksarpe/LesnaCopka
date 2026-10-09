import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { colors, medals, shadows } from '@/theme/tokens';
import type { Duel, DuelKind, DuelSide } from '@/types';
import { daysLabel, DUEL_KINDS, duelPhase, duelScoreShort, duelShare, duelTimeText, PHASE_LABEL, type DuelPhase } from '@/utils/duels';
import { fmtInt } from '@/utils/format';
import { Avatar, authorRingColor } from './Avatar';
import { Icon, type IconName } from './Icon';
import { Pill } from './Pill';
import { Txt } from './Txt';

/** Kolory pigułki fazy pojedynku. */
export const PHASE_TONE: Record<DuelPhase, { bg: string; fg: string }> = {
  incoming: { bg: colors.warnBg, fg: colors.warnTitle },
  outgoing: { bg: colors.chip, fg: colors.tagNeutralText },
  active: { bg: colors.primaryTint, fg: colors.primaryTintText },
  settling: { bg: colors.infoBg, fg: colors.infoText },
  won: { bg: medals[0], fg: colors.legendInk },
  lost: { bg: colors.dangerBg, fg: colors.dangerText },
  draw: { bg: colors.chip, fg: colors.tagNeutralText },
  declined: { bg: colors.chip, fg: colors.muted },
  cancelled: { bg: colors.chip, fg: colors.muted },
  expired: { bg: colors.chip, fg: colors.muted },
};

export function PhasePill({ phase }: { phase: DuelPhase }) {
  const t = PHASE_TONE[phase];
  return <Pill label={PHASE_LABEL[phase]} bg={t.bg} color={t.fg} size={12} padV={4} padH={9} />;
}

/** Kafel rodzaju pojedynku (miarka / koszyk / liść). */
export function DuelKindTile({ kind, size = 40, dark }: { kind: DuelKind; size?: number; dark?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: dark ? 'rgba(255,255,255,0.12)' : colors.canvas,
      }}
    >
      <Icon name={DUEL_KINDS[kind].icon} filled size={Math.round(size * 0.55)} color={dark ? colors.xpOnDark : colors.outlineText} />
    </View>
  );
}

/**
 * Pasek wyników: gracz (zielony, z lewej) kontra przeciwnik (brąz, z prawej) – udział w sumie wyników.
 * `compact` – w karcie listy (bez avatarów).
 */
export function DuelScoreBar({ kind, me, opponent, compact }: { kind: DuelKind; me: DuelSide; opponent: DuelSide; compact?: boolean }) {
  const share = duelShare(me.score, opponent.score);
  const lead = me.score === opponent.score ? 0 : me.score > opponent.score ? 1 : -1;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {compact ? null : <Avatar size={34} ringWidth={2} ringColor={colors.primary} avatar={me.user.avatar} />}
        <View style={{ flex: 1 }}>
          <Txt f="n8" size={12} color={colors.muted} numberOfLines={1}>
            Ty
          </Txt>
          <Txt f="b7" size={compact ? 20 : 24} lh={1.1} color={lead > 0 ? colors.primaryText : colors.ink}>
            {duelScoreShort(kind, me.score)}
          </Txt>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Txt f="n8" size={12} color={colors.muted} numberOfLines={1}>
            {opponent.user.name}
          </Txt>
          <Txt f="b7" size={compact ? 20 : 24} lh={1.1} color={lead < 0 ? colors.outlineText : colors.ink}>
            {duelScoreShort(kind, opponent.score)}
          </Txt>
        </View>
        {compact ? null : <Avatar size={34} ringWidth={2} ringColor={authorRingColor(opponent.user)} avatar={opponent.user.avatar} />}
      </View>
      <View
        accessible
        accessibilityLabel={`Ty ${duelScoreShort(kind, me.score)}, ${opponent.user.name} ${duelScoreShort(kind, opponent.score)}`}
        style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: colors.track, gap: 2 }}
      >
        <View style={{ flex: Math.max(0.02, share), backgroundColor: colors.primary }} />
        <View style={{ flex: Math.max(0.02, 1 - share), backgroundColor: colors.outlineText, opacity: 0.75 }} />
      </View>
    </View>
  );
}

interface DuelCardProps {
  duel: Duel;
  now: number;
  onPress: () => void;
  /** Przyciski pod kartą (Przyjmij / Odrzuć, Anuluj) – poza obszarem tapnięcia (web: bez zagnieżdżonych przycisków). */
  actions?: ReactNode;
}

/** Karta pojedynku na liście: rodzaj, przeciwnik, faza, pasek wyników (trwa / po końcu), czas, wynik i XP. */
export function DuelCard({ duel: d, now, onPress, actions }: DuelCardProps) {
  const phase = duelPhase(d, now);
  const scored = d.status === 'active' || d.status === 'finished';
  const who = d.iAmChallenger ? `Twoje wyzwanie dla: ${d.opponent.user.name}` : `Wyzwanie od: ${d.opponent.user.name}`;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 20, boxShadow: shadows.card, overflow: 'hidden' }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Pojedynek z ${d.opponent.user.name}: ${DUEL_KINDS[d.kind].label}, ${PHASE_LABEL[phase]}`}
        style={({ pressed }) => ({ padding: 14, gap: 12, backgroundColor: pressed ? '#FDFBF6' : colors.card })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {scored ? <DuelKindTile kind={d.kind} /> : <Avatar size={40} ringWidth={2.5} ringColor={authorRingColor(d.opponent.user)} avatar={d.opponent.user.avatar} />}
          <View style={{ flex: 1, gap: 1 }}>
            <Txt f="n8" size={15} numberOfLines={1}>
              {DUEL_KINDS[d.kind].label} · {daysLabel(d.days)}
            </Txt>
            <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
              {scored ? `z ${d.opponent.user.name}` : who}
            </Txt>
          </View>
          <PhasePill phase={phase} />
        </View>
        {scored ? <DuelScoreBar kind={d.kind} me={d.me} opponent={d.opponent} compact /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name={phase === 'won' || phase === 'lost' || phase === 'draw' ? 'history' : 'schedule'} size={16} color={colors.muted} />
          <Txt f="n7" size={12} color={colors.muted} style={{ flex: 1 }} numberOfLines={1}>
            {duelTimeText(d, now)}
          </Txt>
          {d.status === 'finished' && d.xp ? (
            <Txt f="n8" size={13} color={colors.primaryText}>
              +{fmtInt(d.xp)} XP
            </Txt>
          ) : null}
          <Icon name="chevron_right" size={20} color={colors.disabled} />
        </View>
      </Pressable>
      {actions ? <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 14 }}>{actions}</View> : null}
    </View>
  );
}

/**
 * Mały przycisk pod kartą: zielony 3D albo obrysowany (jak przy zaproszeniach na ekranie Znajomi).
 */
export function DuelActionButton({
  icon,
  label,
  onPress,
  outline,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  outline?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        backgroundColor: outline ? (pressed ? colors.outlineHover : 'transparent') : colors.primary,
        borderWidth: outline ? 2 : 0,
        borderColor: colors.outline,
        borderRadius: 999,
        paddingVertical: outline ? 7 : 9,
        paddingHorizontal: 12,
        boxShadow: outline ? undefined : `0px ${pressed ? 1 : 3}px 0px ${colors.primaryShadow}`,
        transform: [{ translateY: pressed && !outline ? 2 : 0 }],
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={18} color={outline ? colors.outlineText : colors.primaryInk} />
      <Txt f="n8" size={14} color={outline ? colors.outlineText : colors.primaryInk}>
        {label}
      </Txt>
    </Pressable>
  );
}
