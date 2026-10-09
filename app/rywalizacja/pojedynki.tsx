import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { Button3D } from '@/components/Button3D';
import { Card } from '@/components/Card';
import { DuelActionButton, DuelCard } from '@/components/DuelCard';
import { DuelChallengeSheet, type DuelChallengePreset } from '@/components/DuelChallengeSheet';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { SkeletonCard } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useServices } from '@/services';
import { acceptDuel, cancelDuel, declineDuel } from '@/store/duels';
import { useSimStore } from '@/store/useSimStore';
import { colors } from '@/theme/tokens';
import type { Duel, DuelDays, DuelKind } from '@/types';
import { DUEL_COMMON_RULE, DUEL_DAYS, isDuelKind } from '@/utils/duels';

const asKind = (v?: string): DuelKind | undefined => (isDuelKind(v) ? v : undefined);
const asDays = (v?: string): DuelDays | undefined => (DUEL_DAYS.includes(Number(v) as DuelDays) ? (Number(v) as DuelDays) : undefined);

/**
 * Pojedynki (z ekranu Rywalizacja, powiadomienia, mini profilu znajomego): bilans W / R / P, „Wyzwij znajomego”,
 * wyzwania do gracza (Przyjmij / Odrzuć), trwające (pasek wyników, czas do końca), wysłane (Anuluj) i zakończone.
 * `?wyzwij=<id>` (mini profil) otwiera arkusz wyzwania z wybranym znajomym (`rodzaj`, `dni` – rewanż).
 */
export default function DuelsScreen() {
  const { duels } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const params = useLocalSearchParams<{ wyzwij?: string; rodzaj?: string; dni?: string }>();
  const overview = useAsync(() => duels.getDuels(), [network]);
  const now = useNow(30_000);
  const [sheet, setSheet] = useState<DuelChallengePreset | null>(() =>
    params.wyzwij ? { opponentId: params.wyzwij, kind: asKind(params.rodzaj), days: asDays(params.dni) } : null,
  );
  const [busy, setBusy] = useState<string[]>([]);

  // Powrót ze szczegółów pojedynku: stan mógł się zmienić (przyjęcie, rozstrzygnięcie) – po cichu od nowa.
  const focused = useRef(false);
  const reload = overview.reload;
  useFocusEffect(
    useCallback(() => {
      if (focused.current) void reload();
      focused.current = true;
    }, [reload]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/rywalizacja' as Href));
  const open = (d: Duel) => router.push(`/rywalizacja/pojedynek/${d.id}` as Href);

  const accept = async (d: Duel) => {
    setBusy((b) => [...b, d.id]);
    if (await acceptDuel(duels, d)) await overview.reload();
    setBusy((b) => b.filter((x) => x !== d.id));
  };
  const refresh = () => void overview.reload();

  const data = overview.data;
  const empty = !!data && !data.active.length && !data.incoming.length && !data.outgoing.length && !data.finished.length;
  // Jeden pojedynek pary naraz – w arkuszu tych znajomych nie da się wybrać.
  const busyIds = data ? [...data.active, ...data.incoming, ...data.outgoing].map((d) => d.opponent.user.id) : [];

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 18, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Pojedynki
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <RecordCard record={data?.record} onChallenge={() => setSheet({})} />

        {overview.error && !data ? (
          <OfflineCard onRetry={overview.reload} />
        ) : !data ? (
          <>
            <SkeletonCard lines={2} />
            <SkeletonCard lines={2} />
          </>
        ) : empty ? (
          <StateCard
            icon="bolt"
            title="Nie masz jeszcze pojedynków"
            text="Wyzwij znajomego: kto zbierze więcej grzybów, więcej gatunków albo znajdzie największy okaz?"
            action="Wyzwij znajomego"
            onAction={() => setSheet({})}
          />
        ) : (
          <>
            <Section title="Wyzwania do Ciebie" items={data.incoming}>
              {(d) => (
                <DuelCard
                  key={d.id}
                  duel={d}
                  now={now}
                  onPress={() => open(d)}
                  actions={
                    <>
                      <DuelActionButton icon="bolt" label="Przyjmij" disabled={busy.includes(d.id)} onPress={() => void accept(d)} />
                      <DuelActionButton icon="close" label="Odrzuć" outline disabled={busy.includes(d.id)} onPress={() => declineDuel(duels, d, refresh)} />
                    </>
                  }
                />
              )}
            </Section>
            <Section title="Trwają" items={data.active}>
              {(d) => <DuelCard key={d.id} duel={d} now={now} onPress={() => open(d)} />}
            </Section>
            <Section title="Wysłane" items={data.outgoing}>
              {(d) => (
                <DuelCard
                  key={d.id}
                  duel={d}
                  now={now}
                  onPress={() => open(d)}
                  actions={
                    <DuelActionButton icon="undo" label="Anuluj wyzwanie" outline disabled={busy.includes(d.id)} onPress={() => cancelDuel(duels, d, refresh)} />
                  }
                />
              )}
            </Section>
            <Section title="Zakończone" items={data.finished}>
              {(d) => <DuelCard key={d.id} duel={d} now={now} onPress={() => open(d)} />}
            </Section>
          </>
        )}

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 }}>
          <Icon name="verified" size={16} color={colors.muted} />
          <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
            {DUEL_COMMON_RULE} Najwyżej 3 pojedynki w toku naraz i jeden z tą samą osobą.
          </Txt>
        </View>
      </View>

      <DuelChallengeSheet
        // Dopiero ze znaną listą pojedynków w toku (wejście z mini profilu otwiera arkusz od razu po wejściu).
        visible={!!sheet && (!!data || !!overview.error)}
        preset={sheet ?? undefined}
        busyIds={busyIds}
        onClose={() => setSheet(null)}
        onCreated={() => void overview.reload()}
      />
    </Screen>
  );
}

function Section({ title, items, children }: { title: string; items: Duel[]; children: (d: Duel) => ReactNode }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title={title} count={String(items.length)} />
      {items.map(children)}
    </View>
  );
}

/** Ciemna karta: bilans wygranych / remisów / przegranych i „Wyzwij znajomego”. */
function RecordCard({ record, onChallenge }: { record?: { won: number; lost: number; draw: number }; onChallenge: () => void }) {
  return (
    <Card dark radius={26} padding={18} gap={16}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bolt" filled size={28} color={colors.xpOnDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt f="b7" size={20} color={colors.onDark} lh={1.2}>
            Pojedynki ze znajomymi
          </Txt>
          <Txt f="n6" size={13} color={colors.onDarkMuted}>
            Największy okaz, najwięcej grzybów albo gatunków – 1, 3 lub 7 dni.
          </Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Stat label="Wygrane" value={record?.won} />
        <Stat label="Remisy" value={record?.draw} />
        <Stat label="Przegrane" value={record?.lost} />
      </View>
      <Button3D title="Wyzwij znajomego" icon="bolt" size="md" onDark onPress={onChallenge} />
    </Card>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, paddingVertical: 8, alignItems: 'center' }}>
      <Txt f="b7" size={24} color={colors.onDark} lh={1.2}>
        {value == null ? '–' : value}
      </Txt>
      <Txt f="n7" size={12} color={colors.onDarkMuted}>
        {label}
      </Txt>
    </View>
  );
}
