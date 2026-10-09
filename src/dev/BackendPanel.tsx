import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Linking, Pressable, View } from 'react-native';

import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { useVoivodeship } from '@/hooks/useVoivodeship';
import { useServices } from '@/services';
import { connect } from '@/services/supabase';
import { getAccountInfo, type AccountInfo } from '@/services/supabase/account';
import { BACKEND, supabase, SUPABASE_URL } from '@/services/supabase/client';
import { devFinalizeRivalry, devRivalryAct, devSeedRivalry } from '@/services/supabase/duels';
import { devBotsAct, devSeedSocial } from '@/services/supabase/feed';
import { DEV_ACTIVITY_WEEKS, devRefreshRankings, devSeedActivity } from '@/services/supabase/stats';
import { useBackendStatus } from '@/services/supabase/status';
import {
  devImportDemoPlayer,
  devNewAccount,
  devPullState,
  devResetPlayer,
  devSyncNow,
  devToolsEnabled,
  type DevResult,
} from '@/services/supabase/sync';
import { pollActivity } from '@/store/notify';
import { useFeedSync } from '@/store/useFeedSync';
import { EVENT_LABEL, isPhotoEvent, useOutboxStore, type OutboxItem } from '@/store/useOutboxStore';
import { useStatsSync } from '@/store/useStatsSync';
import { ui } from '@/store/useUiStore';
import { plural } from '@/utils/format';
import { colors } from '@/theme/tokens';
import { mailCatcherUrl } from '@/utils/account';

interface DbSnapshot {
  species: number | null;
  gminy: number | null;
  badges: number | null;
  profiles: number | null;
  me: { handle: string; level: number; total_xp: number } | null;
}

const count = async (table: string) => {
  const { count: n, error } = await supabase!.from(table).select('*', { count: 'exact', head: true });
  if (error) throw error;
  return n;
};

/** „14:05:12” albo „6 paź, 14:05”, gdy nie dziś. */
function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const time = d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}, ${time}`;
}

/** Krótki opis zdarzenia z kolejki: typ + najważniejsze pole. */
function describeItem(x: OutboxItem): string {
  switch (x.type) {
    case 'trip.start':
      return `${EVENT_LABEL[x.type]} · ${x.payload.gminaId}`;
    case 'find.submit':
      return `${EVENT_LABEL[x.type]} · ${x.payload.speciesId}`;
    case 'trip.progress':
    case 'trip.finish':
      return `${EVENT_LABEL[x.type]} · ${(x.payload.distanceM / 1000).toFixed(2)} km`;
    case 'profile.update':
      return `${EVENT_LABEL[x.type]} · @${x.payload.handle}`;
    case 'trip.publish':
      return `${EVENT_LABEL[x.type]} · ${x.payload.tripId.slice(0, 8)}…${x.payload.hideRoute ? ' · trasa ukryta' : ''}`;
    case 'challenge.accept':
      return `${EVENT_LABEL[x.type]} · ${x.payload.gminaId} · ${x.payload.challengeId.slice(0, 8)}…`;
    case 'gmina.follow':
      return `${x.payload.follow ? 'obserwuj' : 'przestań obserwować'} · ${x.payload.gminaId}`;
    case 'photo.avatar':
      return `${EVENT_LABEL[x.type]} · ${x.payload.photo ? 'zdjęcie' : 'bez zdjęcia'}`;
    case 'photo.delete':
      return `${EVENT_LABEL[x.type]} · ${x.payload.bucket} · ${x.payload.paths.length}`;
    case 'terms.accept':
      return `${EVENT_LABEL[x.type]} · wersja ${x.payload.version}`;
    case 'onboarding.complete':
      return EVENT_LABEL[x.type];
    default:
      return `${EVENT_LABEL[x.type]} · ${x.payload.findId.slice(0, 8)}…`;
  }
}

/** Sekcja „Backend” panelu /dev: tryb, połączenie z Supabase, kolejka synchronizacji gry i narzędzia gracza. */
export function BackendPanel() {
  const { feed } = useServices();
  // Generator aktywności działa dla województwa z ekranu Gminy (wybrane albo z lokalizacji / gminy domowej).
  const { voivodeship } = useVoivodeship();
  const status = useBackendStatus();
  const outbox = useOutboxStore();
  const [snap, setSnap] = useState<DbSnapshot | null>(null);
  const [devTools, setDevTools] = useState<boolean | null>(null);
  const [auth, setAuth] = useState<AccountInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DevResult | null>(null);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      await connect();
      const uid = useBackendStatus.getState().userId;
      const [species, gminy, badges, profiles, me, tools] = await Promise.all([
        count('species'),
        count('gminy'),
        count('badges'),
        count('profiles'),
        uid
          ? supabase.from('profiles').select('handle, level, total_xp').eq('id', uid).maybeSingle().then((r) => r.data)
          : Promise.resolve(null),
        devToolsEnabled(),
      ]);
      setSnap({ species, gminy, badges, profiles, me });
      setDevTools(tools);
      setAuth(await getAccountInfo().catch(() => null));
    } catch {
      setSnap(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    // Jednorazowe sprawdzenie bazy po otwarciu panelu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  /** Akcja panelu: wynik w karcie + toast; po niej odświeżamy podgląd bazy. */
  const act = (label: string, fn: () => Promise<DevResult>) => async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fn();
      setResult(r);
      ui.toast(r.ok ? `${label}: gotowe` : `${label}: ${r.message}`, r.ok ? 'sync' : 'cloud_off');
    } finally {
      setBusy(false);
    }
    void refresh();
  };

  /** Boty społeczności: wynik (liczby z serwera) w toaście; feed i znajomi pobiorą się od nowa. */
  const social = (label: string, fn: () => Promise<DevResult>, after?: () => Promise<string | null>) => async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fn();
      const extra = r.ok && after ? await after() : null;
      const out = { ok: r.ok, message: [r.message, extra].filter(Boolean).join(' · ') };
      setResult(out);
      if (r.ok) useFeedSync.getState().invalidate();
      ui.toast(`${label}: ${out.message}`, r.ok ? 'group' : 'cloud_off');
    } finally {
      setBusy(false);
    }
  };

  /** Rankingi gmin (generator, przeliczenie): wynik w karcie i toaście; ekrany Gminy pobiorą dane od nowa. */
  const rankings = (label: string, fn: () => Promise<DevResult>) => async () => {
    if (busy) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fn();
      setResult(r);
      if (r.ok) useStatsSync.getState().invalidate();
      ui.toast(`${label}: ${r.message}`, r.ok ? 'emoji_events' : 'cloud_off');
    } finally {
      setBusy(false);
    }
  };

  /** Po reakcjach botów – aktywność od razu do centrum powiadomień (bez czekania 2 min). */
  const pollNow = async () => {
    const n = await pollActivity(feed, { toast: false });
    return n ? `${n} ${plural(n, 'nowe powiadomienie', 'nowe powiadomienia', 'nowych powiadomień')}` : 'bez nowych powiadomień';
  };

  const confirmAct = (title: string, message: string, label: string, fn: () => Promise<DevResult>) => () =>
    ui.confirm({ title, message, icon: 'cloud', confirmLabel: label, danger: true, onConfirm: () => void act(label, fn)() });

  const online = status.state === 'online';
  // Lokalna skrzynka z kodami logowania (npx supabase start) – w chmurze brak.
  const mailbox = mailCatcherUrl(SUPABASE_URL);
  const tone = !supabase ? colors.muted : online ? colors.primaryText : status.state === 'connecting' ? colors.warnIcon : colors.danger;
  const label = !supabase
    ? 'Mocki (bez bazy)'
    : online
      ? 'Połączono z Supabase'
      : status.state === 'connecting'
        ? 'Łączenie…'
        : 'Brak połączenia z bazą';
  const linked = !!status.userId && outbox.syncedUserId === status.userId;
  const linkLabel = !status.userId
    ? '—'
    : linked
      ? 'tak – stan gry z tego konta'
      : outbox.syncedUserId
        ? `inne konto (${outbox.syncedUserId.slice(0, 8)}…) – następna synchronizacja przejmie stan serwera`
        : 'jeszcze nie – pierwsza synchronizacja zastąpi stan demo stanem z serwera';

  return (
    <Card radius={22} padding={16} gap={10}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={online || !supabase ? 'wifi' : 'wifi_off'} filled size={20} color={colors.primaryText} />
        <Txt f="b7" size={18} style={{ flex: 1 }}>
          Backend
        </Txt>
        {supabase ? (
          <Pressable onPress={refresh} disabled={busy} hitSlop={8} accessibilityLabel="Odśwież połączenie">
            <Icon name="refresh" size={22} color={busy ? colors.disabled : colors.ink} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone }} />
        <Txt f="n8" size={14} color={tone}>
          {label}
        </Txt>
      </View>

      <Row k="Tryb" v={BACKEND === 'supabase' ? 'supabase (.env.local)' : 'mock'} />
      {supabase ? <Row k="Adres" v={SUPABASE_URL} /> : null}
      {supabase ? <Row k="Słowniki w aplikacji" v={status.catalogSource} /> : null}
      {status.userId ? (
        <Row
          k="Konto"
          v={auth?.userId === status.userId ? (auth.anonymous ? `anonimowe${auth.pendingEmail ? ` (czeka na kod: ${auth.pendingEmail})` : ''}` : `e-mail: ${auth.email}`) : '…'}
        />
      ) : null}
      {status.userId ? <Row k="Id konta" v={status.userId} selectable /> : null}
      {supabase && mailbox ? (
        <Pressable onPress={() => void Linking.openURL(mailbox).catch(() => {})} accessibilityRole="link" hitSlop={4}>
          <Row k="Kody z e-maili" v={`${mailbox} (Mailpit – otwórz)`} />
        </Pressable>
      ) : null}
      {supabase ? <Row k="Powiązanie" v={linkLabel} /> : null}
      {snap?.me ? <Row k="Profil w bazie" v={`@${snap.me.handle} · Lv ${snap.me.level} · ${snap.me.total_xp} XP`} /> : null}
      {snap ? (
        <Row k="W bazie" v={`${snap.species} gatunków · ${snap.gminy} gmin · ${snap.badges} odznak · ${snap.profiles} kont`} />
      ) : null}
      {status.error ? (
        <Txt f="n6" size={12} color={colors.danger} selectable>
          {status.error}
        </Txt>
      ) : null}

      {supabase ? (
        <>
          <Label>Synchronizacja gry</Label>
          <Row k="Kolejka" v={outbox.items.length ? `${outbox.items.length} zdarzeń do wysłania` : 'pusta'} />
          <Row k="Zdjęcia" v={`${outbox.items.filter(isPhotoEvent).length} w kolejce`} />
          {outbox.items.slice(0, 8).map((x) => (
            <QueueRow key={x.id} title={describeItem(x)} meta={x.attempts ? `prób: ${x.attempts}` : undefined} error={x.lastError} />
          ))}
          {outbox.items.length > 8 ? (
            <Txt f="n6" size={12} color={colors.muted}>
              …i {outbox.items.length - 8} kolejnych
            </Txt>
          ) : null}
          <Row k="Ostatnie wysłanie" v={fmtTime(outbox.lastSyncAt)} />
          <Row k="Stan z serwera" v={fmtTime(outbox.lastHydrateAt)} />
          {outbox.failed.length ? (
            <>
              <Row k="Odrzucone" v={`${outbox.failed.length} (ostatnie ${Math.min(outbox.failed.length, 5)})`} />
              {outbox.failed.slice(0, 5).map((f) => (
                <QueueRow key={`${f.item.id}-${f.failedAt}`} title={describeItem(f.item)} meta={fmtTime(f.failedAt)} error={f.error} />
              ))}
            </>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
            <Chip onPress={act('Synchronizacja', devSyncNow)} disabled={busy}>
              Synchronizuj teraz
            </Chip>
            <Chip onPress={act('Stan z serwera', devPullState)} disabled={busy}>
              Pobierz stan z serwera
            </Chip>
          </View>

          <Label>Gracz na serwerze</Label>
          {devTools === false ? (
            <Txt f="n7" size={12} color={colors.warnIcon}>
              Narzędzia dev są wyłączone na serwerze (app_config.dev_tools) – „Wgraj gracza demo”, „Nowy gracz”,
              testowi grzybiarze i generator aktywności w gminach nie zadziałają.
            </Txt>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip
              disabled={busy}
              onPress={confirmAct(
                'Wgrać gracza demo?',
                'Dane gry tego konta na serwerze zostaną skasowane i zastąpione graczem z makiety (Kuba Nowak, Lv 14, atlas i odznaki). Wyprawy i znaleziska znikną.',
                'Wgraj gracza demo',
                devImportDemoPlayer,
              )}
            >
              Wgraj gracza demo
            </Chip>
            <Chip
              disabled={busy}
              onPress={confirmAct(
                'Nowy gracz?',
                'Postęp tego konta na serwerze zostanie skasowany (Lv 1, pusty atlas). Nick, imię i gmina domowa zostają.',
                'Resetuj gracza',
                devResetPlayer,
              )}
            >
              Nowy gracz (reset na serwerze)
            </Chip>
            <Chip
              disabled={busy}
              onPress={confirmAct(
                'Nowe konto?',
                'Wylogujemy obecne konto anonimowe (bez powrotu) i założymy nowe – świeży gracz z serwera. Niewysłane zdarzenia przepadną.',
                'Nowe konto',
                devNewAccount,
              )}
            >
              Nowe konto
            </Chip>
          </View>

          <Label>Społeczność (feed, znajomi, aktywność)</Label>
          <Row
            k="Wpisy w wysyłce"
            v={outbox.localPosts.length ? `${outbox.localPosts.length} (czekają na serwer – „wysyłanie…” w feedzie)` : 'brak'}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip disabled={busy} onPress={social('Testowi grzybiarze', devSeedSocial)}>
              Dodaj testowych grzybiarzy
            </Chip>
            <Chip disabled={busy} onPress={social('Grzybiarze reagują', devBotsAct, pollNow)}>
              Grzybiarze reagują
            </Chip>
          </View>
          <Txt f="n6" size={12} color={colors.muted}>
            Boty na serwerze: wpisy w feedzie, część z nich to Twoi znajomi, część zaprasza Cię do znajomych. „Grzybiarze
            reagują” – reakcje i komentarze pod Twoimi wpisami oraz zaproszenia (trafiają do centrum powiadomień).
          </Txt>

          <Label>Rankingi i statystyki gmin</Label>
          <Row k="Województwo" v={`${voivodeship} (wybrane na ekranie Gminy)`} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip disabled={busy} onPress={rankings('Aktywność w gminach', () => devSeedActivity(voivodeship))}>
              Wygeneruj aktywność w gminach
            </Chip>
            <Chip disabled={busy} onPress={rankings('Rankingi', devRefreshRankings)}>
              Przelicz rankingi
            </Chip>
          </View>
          <Txt f="n6" size={12} color={colors.muted}>
            Ciche boty zbierają grzyby w gminach województwa (i zawsze w podlaskim) – do {DEV_ACTIVITY_WEEKS} tyg. wstecz,
            już po 24 h, więc liczą się w rankingach, rekordach i porównaniu okazów; serwer od razu przelicza rankingi.
            Twoje wyprawy wchodzą do rankingów po 24 h (ranking odświeża się sam najwyżej co 15 min).
          </Txt>

          <Label>Rywalizacja (walki o okaz, pojedynki, ranking grzybiarzy)</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip disabled={busy} onPress={social('Rywale', () => devSeedRivalry(voivodeship), pollNow)}>
              Dodaj rywali
            </Chip>
            <Chip disabled={busy} onPress={social('Rywale działają', devRivalryAct, pollNow)}>
              Rywale działają
            </Chip>
            <Chip disabled={busy} onPress={social('Rozstrzygnięcie', devFinalizeRivalry, pollNow)}>
              Rozstrzygnij teraz
            </Chip>
          </View>
          <Txt f="n6" size={12} color={colors.muted}>
            „Dodaj rywali” – boty ze zmierzonymi okazami tego tygodnia (widoczne od razu), boty-znajomi, wyzwanie bota do Ciebie
            i trwający pojedynek. „Rywale działają” – boty przyjmują Twoje wyzwania, dokładają okazy w pojedynkach i wyprzedzają
            Cię w walce. „Rozstrzygnij teraz” – zakończone tygodnie walk i pojedynki bez czekania (nagrody, trofea, powiadomienia).
          </Txt>
          {result ? (
            <Txt f="n7" size={12} color={result.ok ? colors.primaryText : colors.danger} selectable>
              {result.message}
            </Txt>
          ) : null}
          <Txt f="n6" size={12} color={colors.muted}>
            Gra liczy się lokalnie (działa offline), a akcje (wyprawy, znaleziska, profil) idą kolejką na serwer. Przy pustej
            kolejce aplikacja przyjmuje stan z serwera – nadpisuje on akcje dev z tego panelu (XP, gatunki, odznaki, scenariusze).
          </Txt>
        </>
      ) : (
        <Txt f="n6" size={12} color={colors.muted}>
          Włącz bazę: EXPO_PUBLIC_BACKEND=supabase w .env.local i restart `npx expo start`.
        </Txt>
      )}
    </Card>
  );
}

function Row({ k, v, selectable }: { k: string; v: string; selectable?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Txt f="n7" size={13} color={colors.muted} style={{ width: 128 }}>
        {k}
      </Txt>
      <Txt f="n7" size={13} style={{ flex: 1 }} selectable={selectable}>
        {v}
      </Txt>
    </View>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <Txt f="n8" size={11} color={colors.muted} upper ls={0.08} style={{ marginTop: 4 }}>
      {children}
    </Txt>
  );
}

function QueueRow({ title, meta, error }: { title: string; meta?: string; error?: string }) {
  return (
    <View style={{ backgroundColor: colors.canvas, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 10, gap: 2 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Txt f="n8" size={12} style={{ flex: 1 }}>
          {title}
        </Txt>
        {meta ? (
          <Txt f="n7" size={12} color={colors.muted}>
            {meta}
          </Txt>
        ) : null}
      </View>
      {error ? (
        <Txt f="n6" size={11} color={colors.danger} selectable>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

function Chip({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: colors.canvas,
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 12,
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      <Txt f="n8" size={13}>
        {children}
      </Txt>
    </Pressable>
  );
}
