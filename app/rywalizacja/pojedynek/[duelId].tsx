import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { Avatar, authorRingColor } from '@/components/Avatar';
import { Button3D } from '@/components/Button3D';
import { Card } from '@/components/Card';
import { DuelBestFind } from '@/components/DuelBestFind';
import { DuelKindTile, DuelScoreBar, PhasePill } from '@/components/DuelCard';
import { DuelChallengeSheet, type DuelChallengePreset } from '@/components/DuelChallengeSheet';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { OutlineButton } from '@/components/PlayerSheet';
import { Screen } from '@/components/Screen';
import { SkeletonCard } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { ServiceError, useServices } from '@/services';
import { acceptDuel, cancelDuel, declineDuel } from '@/store/duels';
import { useSimStore } from '@/store/useSimStore';
import { colors, medals } from '@/theme/tokens';
import type { Duel, DuelSide } from '@/types';
import {
  DUEL_COMMON_RULE,
  DUEL_KINDS,
  DUEL_XP_RULE,
  daysLabel,
  duelPhase,
  duelResultText,
  duelScoreShort,
  duelScoreText,
  duelTimeText,
  isClosedPhase,
} from '@/utils/duels';

/**
 * Pojedynek (z listy pojedynków, powiadomienia): dwie strony z wynikiem (przy „Największym okazie” – najlepsze okazy ze
 * zdjęciem), stan i czas, zasady, wynik z XP, a zależnie od stanu: Przyjmij / Odrzuć, Anuluj albo Rewanż.
 */
export default function DuelScreen() {
  const { duelId } = useLocalSearchParams<{ duelId: string }>();
  const { duels } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const duel = useAsync(() => duels.getDuel(String(duelId)), [duelId, network]);
  const now = useNow(30_000);
  const [sheet, setSheet] = useState<DuelChallengePreset | null>(null);
  const [busy, setBusy] = useState(false);

  // Powrót na ekran (np. z wyprawy ze znaleziskiem) – wynik mógł się zmienić.
  const focused = useRef(false);
  const reload = duel.reload;
  useFocusEffect(
    useCallback(() => {
      if (focused.current) void reload();
      focused.current = true;
    }, [reload]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/rywalizacja/pojedynki' as Href));
  const d = duel.data;
  const refresh = () => void duel.reload();
  const accept = async (x: Duel) => {
    setBusy(true);
    const next = await acceptDuel(duels, x);
    if (next) duel.setData(() => next);
    setBusy(false);
  };

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Pojedynek
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        {duel.error && !d ? (
          duel.error instanceof ServiceError && duel.error.code === 'NOT_FOUND' ? (
            <StateCard icon="bolt" title="Nie ma takiego pojedynku" text="Mógł zostać anulowany albo zniknąć po blokadzie." action="Wszystkie pojedynki" onAction={() => router.replace('/rywalizacja/pojedynki' as Href)} />
          ) : (
            <OfflineCard onRetry={duel.reload} />
          )
        ) : !d ? (
          <>
            <SkeletonCard lines={2} height={120} />
            <SkeletonCard lines={3} height={160} />
          </>
        ) : (
          <DuelBody
            d={d}
            now={now}
            busy={busy}
            onAccept={() => void accept(d)}
            onDecline={() => declineDuel(duels, d, refresh)}
            onCancel={() => cancelDuel(duels, d, refresh)}
            onRematch={() => setSheet({ opponentId: d.opponent.user.id, kind: d.kind, days: d.days })}
          />
        )}
      </View>

      <DuelChallengeSheet
        visible={!!sheet}
        preset={sheet ?? undefined}
        onClose={() => setSheet(null)}
        onCreated={(next) => router.replace(`/rywalizacja/pojedynek/${next.id}` as Href)}
      />
    </Screen>
  );
}

function DuelBody({
  d,
  now,
  busy,
  onAccept,
  onDecline,
  onCancel,
  onRematch,
}: {
  d: Duel;
  now: number;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onRematch: () => void;
}) {
  const phase = duelPhase(d, now);
  const kind = DUEL_KINDS[d.kind];
  const scored = d.status === 'active' || d.status === 'finished';
  const result = duelResultText(d);
  return (
    <>
      <Card dark radius={26} padding={18} gap={14}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <DuelKindTile kind={d.kind} size={48} dark />
          <View style={{ flex: 1 }}>
            <Txt f="b7" size={20} color={colors.onDark} lh={1.2}>
              {kind.label}
            </Txt>
            <Txt f="n6" size={13} color={colors.onDarkMuted}>
              {daysLabel(d.days)} · {d.iAmChallenger ? 'Twoje wyzwanie' : `wyzwanie od ${d.opponent.user.name}`}
            </Txt>
          </View>
          <PhasePill phase={phase} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="schedule" size={16} color={colors.onDarkMuted} />
          <Txt f="n7" size={13} color={colors.onDarkSoft}>
            {duelTimeText(d, now)}
          </Txt>
        </View>
      </Card>

      <Card radius={24} padding={16} gap={14}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <SideColumn side={d.me} kind={d.kind} mine scored={scored} lead={scored && d.me.score > d.opponent.score} />
          <View style={{ paddingTop: 26, paddingHorizontal: 6 }}>
            <Txt f="b8" size={18} color={colors.faint}>
              vs
            </Txt>
          </View>
          <SideColumn side={d.opponent} kind={d.kind} scored={scored} lead={scored && d.opponent.score > d.me.score} />
        </View>
        {scored ? <DuelScoreBar kind={d.kind} me={d.me} opponent={d.opponent} compact /> : null}
        {phase === 'settling' ? (
          <Note icon="hourglass_top" text="Czas minął – czekamy jeszcze na znaleziska wysłane bez zasięgu (do 6 h), potem rozstrzygnięcie." />
        ) : null}
      </Card>

      {d.kind === 'biggest' && scored && (d.me.best || d.opponent.best) ? (
        <View style={{ gap: 10 }}>
          <Txt f="b7" size={18}>
            Najlepsze okazy
          </Txt>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {d.me.best ? <DuelBestFind best={d.me.best} mine label="Twój" /> : <EmptyBest text="Jeszcze bez zmierzonego okazu" />}
            {d.opponent.best ? <DuelBestFind best={d.opponent.best} mine={false} label={d.opponent.user.name} /> : <EmptyBest text="Jeszcze bez zmierzonego okazu" />}
          </View>
        </View>
      ) : null}

      {result ? <ResultBanner phase={phase} title={result.title} body={result.body} /> : null}

      <Card radius={22} padding={16} gap={10}>
        <Txt f="b7" size={18}>
          Zasady
        </Txt>
        <Rule icon={kind.icon} text={kind.rule} />
        <Rule icon="verified" text={DUEL_COMMON_RULE} />
        <Rule icon="cloud_off" text="Znaleziska zapisane bez zasięgu liczą się, jeśli dotrą na serwer do 6 h po końcu." />
        <Rule icon="military_tech" text={DUEL_XP_RULE} />
      </Card>

      <View style={{ gap: 10 }}>
        {phase === 'incoming' ? (
          <>
            <Button3D title="Przyjmij wyzwanie" icon="bolt" loading={busy} onPress={onAccept} />
            <OutlineButton icon="close" label="Odrzuć" onPress={onDecline} />
          </>
        ) : phase === 'outgoing' ? (
          <OutlineButton icon="undo" label="Anuluj wyzwanie" onPress={onCancel} />
        ) : isClosedPhase(phase) ? (
          <Button3D title="Rewanż" icon="replay" onPress={onRematch} />
        ) : null}
      </View>
    </>
  );
}

function SideColumn({ side, kind, mine, scored, lead }: { side: DuelSide; kind: Duel['kind']; mine?: boolean; scored: boolean; lead: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 4 }}>
      <View>
        <Avatar size={64} ringWidth={3} ringColor={mine ? colors.primary : authorRingColor(side.user)} avatar={side.user.avatar} />
        {lead ? (
          <View style={{ position: 'absolute', right: -6, top: -6, backgroundColor: medals[0], borderRadius: 12, padding: 3 }}>
            <Icon name="trophy" filled size={16} color={colors.legendInk} />
          </View>
        ) : null}
      </View>
      <Txt f="n8" size={14} align="center" numberOfLines={1}>
        {mine ? 'Ty' : side.user.name}
      </Txt>
      <Txt f="b7" size={30} lh={1.1} color={lead ? colors.primaryText : colors.ink}>
        {scored ? duelScoreShort(kind, side.score) : '–'}
      </Txt>
      <Txt f="n7" size={12} color={colors.muted} align="center">
        {scored ? duelScoreText(kind, side.score) : 'po przyjęciu'}
      </Txt>
    </View>
  );
}

function EmptyBest({ text }: { text: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas, borderRadius: 18, padding: 12, alignItems: 'center', justifyContent: 'center', minHeight: 180, gap: 6 }}>
      <Icon name="straighten" size={26} color={colors.faint} />
      <Txt f="n7" size={12} color={colors.muted} align="center">
        {text}
      </Txt>
    </View>
  );
}

function ResultBanner({ phase, title, body }: { phase: ReturnType<typeof duelPhase>; title: string; body: string }) {
  const won = phase === 'won';
  const bg = won ? colors.badgeCard : phase === 'lost' ? colors.dangerBg : colors.canvas;
  const fg = won ? colors.legendText : phase === 'lost' ? colors.dangerText : colors.tagNeutralText;
  const icon: IconName = won ? 'trophy' : phase === 'lost' ? 'flag' : phase === 'draw' ? 'military_tech' : 'info';
  return (
    <View style={{ backgroundColor: bg, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <Icon name={icon} filled size={30} color={fg} />
      <View style={{ flex: 1 }}>
        <Txt f="b7" size={18} color={fg} lh={1.25}>
          {title}
        </Txt>
        <Txt f="n7" size={13} color={fg}>
          {body}
        </Txt>
      </View>
    </View>
  );
}

function Rule({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Icon name={icon} size={18} color={colors.primaryText} />
      <Txt f="n6" size={13} color={colors.bodyDark} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

function Note({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.infoBg, borderRadius: 14, padding: 10 }}>
      <Icon name={icon} size={18} color={colors.infoText} />
      <Txt f="n7" size={12} color={colors.infoText} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}
