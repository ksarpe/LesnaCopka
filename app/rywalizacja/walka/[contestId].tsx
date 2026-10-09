import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Button3D } from '@/components/Button3D';
import { ChoiceChips } from '@/components/ChoiceChips';
import { ContestIcon, contestHref, contestRule } from '@/components/ContestCard';
import { confirmWithdraw, enterFindFlow, reportEntryFlow, useContestCandidates } from '@/components/ContestEnter';
import { ContestEntryRow } from '@/components/ContestEntryRow';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { PlayerSheet } from '@/components/PlayerSheet';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SkeletonRow } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { ServiceError, useServices } from '@/services';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { useStatsSync } from '@/store/useStatsSync';
import { ui, useUiStore } from '@/store/useUiStore';
import { colors, shadows } from '@/theme/tokens';
import type { Contest, ContestBoard, ContestEntry, ContestScope, PostAuthor, RivalryStatus } from '@/types';
import {
  CONTEST_MIN_ENTRANTS,
  CONTEST_SCOPE_IN,
  CONTEST_SCOPE_LABEL,
  contestCountdown,
  contestId as makeContestId,
  contestWeekStart,
  fmtContestScore,
  fmtVisibleFrom,
  fmtWeekRange,
  lastResolvedWeek,
  parseContestId,
  RELATIVE_KEY,
  RIVALRY_QUEUE_GRACE_H,
  weekContests,
} from '@/utils/contests';
import { fmtInt, gminaTitle, plural } from '@/utils/format';

const SCOPES: { value: ContestScope; label: string }[] = (['gmina', 'wojewodztwo', 'polska', 'znajomi'] as const).map(
  (value) => ({
    value,
    label: CONTEST_SCOPE_LABEL[value],
  }),
);
const isScope = (v?: string): v is ContestScope => !!v && SCOPES.some((s) => s.value === v);

const okazy = (n: number) => `${fmtInt(n)} ${plural(n, 'okaz', 'okazy', 'okazów')}`;

/**
 * Walka o okaz: nagłówek (status, czas do końca / do wyników, liczba okazów), przełącznik walk tygodnia, zasięg
 * tablicy (Gmina / Województwo / Polska / Znajomi), mój okaz przypięty (z „Wycofaj”), lista z medalami i miniaturami,
 * „Zgłoś okaz do walki” (okazy z telefonu z tego tygodnia), „Zgłoś okaz” cudzy (moderacja), tap w nick – mini profil.
 * `?zasieg=` – zasięg na start (domyślnie województwo, jak lider na ekranie Rywalizacja).
 */
export default function ContestScreen() {
  const params = useLocalSearchParams<{ contestId: string; zasieg?: string }>();
  // Id walki ma „:” – w ścieżce zakodowany (contestHref).
  const id = decodeURIComponent(params.contestId ?? '');
  const { contests, duels } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const version = useStatsSync((s) => s.version);
  const now = useNow(30_000);
  const [scope, setScope] = useState<ContestScope>(isScope(params.zasieg) ? params.zasieg : 'wojewodztwo');
  // Gmina / województwo zasięgu inne niż domowe (np. „Pokaż” przy okazie z innej gminy); null – domyślne serwera.
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [author, setAuthor] = useState<PostAuthor | null>(null);
  const board = useAsync(() => contests.getContestBoard(id, scope, scopeId), [id, scope, scopeId, network, version]);
  // Dlaczego mój okaz nie ma miejsca (weryfikacja, ukrycie w rankingach); zaślepka / brak sieci – bez tej informacji.
  const status = useAsync(() => duels.getRivalryStatus(), [network, version]);
  // Przy zmianie zasięgu / walki nie pokazujemy poprzedniej tablicy.
  const data =
    board.data && board.data.scope === scope && board.data.contest.id === id && (scopeId == null || board.data.scopeId === scopeId)
      ? board.data
      : undefined;
  const pickScope = (next: ContestScope, nextId: string | null = null) => {
    setScope(next);
    setScopeId(nextId);
  };

  // Walki tego tygodnia (przełącznik) – liczone w telefonie jak na serwerze; nagłówek zanim przyjdzie tablica.
  const species = useCatalogStore((s) => s.species);
  const parsed = parseContestId(id);
  const week = useMemo(() => {
    if (!parsed || !species.length) return [];
    try {
      return weekContests(parsed.weekStart, species);
    } catch {
      return [];
    }
  }, [parsed?.weekStart, species]); // eslint-disable-line react-hooks/exhaustive-deps
  const contest: Contest | undefined = data?.contest ?? week.find((c) => c.id === id);

  const focused = useRef(false);
  const reload = board.reload;
  useFocusEffect(
    useCallback(() => {
      if (focused.current) void reload();
      focused.current = true;
    }, [reload]),
  );

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/rywalizacja' as Href));
  const notFound = board.error instanceof ServiceError && board.error.code === 'NOT_FOUND';

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Walka o okaz
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        {notFound ? (
          <StateCard
            icon="search"
            title="Nie ma takiej walki"
            text="Walki zaczynają się w poniedziałki – sprawdź walki tego tygodnia."
            action="Rywalizacja"
            onAction={() => router.replace('/rywalizacja' as Href)}
          />
        ) : (
          <>
            {contest ? <Hero contest={contest} now={now} /> : null}
            {week.length > 1 ? (
              <ChoiceChips
                options={week.map((c) => ({
                  value: c.id,
                  label: c.kind === 'relative' ? 'Okaz tygodnia' : (species.find((s) => s.id === c.speciesId)?.name ?? c.title),
                }))}
                value={id}
                onChange={(next) => next !== id && router.replace(contestHref(next, scope))}
              />
            ) : null}
            {contest ? <EnterCta contest={contest} board={data} now={now} /> : null}

            <SegmentedControl options={SCOPES} value={scope} onChange={(v) => pickScope(v)} />

            {board.error && !data ? (
              <OfflineCard onRetry={board.reload} />
            ) : !data ? (
              <View style={{ gap: 8 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonRow key={i} />
                ))}
              </View>
            ) : (
              <BoardView board={data} now={now} status={status.data} onAuthor={(e) => setAuthor(e.author)} onScope={pickScope} />
            )}

            {contest && parsed && parsed.weekStart === contestWeekStart(now) ? <PreviousWeekLink now={now} /> : null}
          </>
        )}
      </View>
      <PlayerSheet author={author} onClose={() => setAuthor(null)} />
    </Screen>
  );
}

/* ───────────────────────── Nagłówek ───────────────────────── */

const STATUS: Record<Contest['status'], { label: string; icon: IconName }> = {
  open: { label: 'Trwa', icon: 'local_fire_department' },
  judging: { label: 'Czekamy na wyniki', icon: 'hourglass_top' },
  final: { label: 'Wyniki', icon: 'emoji_events' },
};

function Hero({ contest: c, now }: { contest: Contest; now: number }) {
  const status = c.status === 'open' && now >= Date.parse(c.endsAt) ? 'judging' : c.status;
  return (
    <View style={{ backgroundColor: colors.forest, borderRadius: 26, padding: 18, gap: 12, boxShadow: shadows.forest }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <ContestIcon contest={c} size={54} />
        <View style={{ flex: 1 }}>
          <Txt f="b7" size={22} lh={1.2} color={colors.onDark}>
            {c.title}
          </Txt>
          <Txt f="n7" size={13} color={colors.onDarkMuted}>
            {fmtWeekRange(c.id.slice(0, 10))}
          </Txt>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Pill
          label={STATUS[status].label}
          icon={STATUS[status].icon}
          iconFilled
          bg={status === 'open' ? 'rgba(159,210,102,0.2)' : 'rgba(255,255,255,0.12)'}
          color={status === 'open' ? colors.xpOnDark : colors.onDark}
        />
        {status !== 'final' ? (
          <Pill label={contestCountdown(c, now)} icon="schedule" bg="rgba(255,255,255,0.12)" color={colors.onDark} />
        ) : null}
        {c.entrants > 0 ? (
          <Pill label={`${okazy(c.entrants)} w Polsce`} icon="photo_camera" bg="rgba(255,255,255,0.12)" color={colors.onDark} />
        ) : null}
      </View>
      <Txt f="n6" size={13} color={colors.onDarkSoft}>
        {contestRule(c)}. Walczą okazy z rozmiarem zmierzonym przy dłoni albo monecie, znalezione w tym tygodniu.
      </Txt>
    </View>
  );
}

/* ───────────────────────── Zgłoszenie własnego okazu ───────────────────────── */

/** Walka przyjmuje jeszcze zgłoszenia: trwa albo minęła najwyżej 6 h temu (kolejka offline). */
const accepting = (c: Contest, now: number) =>
  c.status !== 'final' && now < Date.parse(c.endsAt) + RIVALRY_QUEUE_GRACE_H * 3_600_000;

/** Po zgłoszeniu tablica odświeża się sama (useStatsSync – confirmAndEnter). */
function EnterCta({ contest: c, board, now }: { contest: Contest; board?: ContestBoard; now: number }) {
  const { contests } = useServices();
  const candidates = useContestCandidates({ weekStart: c.id.slice(0, 10), speciesId: c.speciesId, kind: c.kind });
  const speciesById = useCatalogStore((s) => s.speciesById);
  const [busy, setBusy] = useState(false);
  if (!accepting(c, now) || !board || board.mine) return null;

  const enter = async () => {
    if (!candidates.length) {
      useUiStore.getState().showDialog({
        title: 'Brak okazu z tego tygodnia',
        message:
          c.kind === 'species'
            ? `Znajdź okaz gatunku tej walki i zrób zdjęcie z dłonią albo monetą obok – zmierzę kapelusz. Potem zgłosisz go tutaj albo na ekranie Nagroda.`
            : 'Zrób zdjęcie grzyba z dłonią albo monetą obok – zmierzę kapelusz. Pojedynczy owocnik, bez kępek i gatunków chronionych.',
        icon: 'straighten',
        actions: [{ label: 'OK', style: 'primary' }],
      });
      return;
    }
    let findId = candidates[0].find.id;
    if (candidates.length > 1) {
      const picked = await ui.choose({
        title: 'Który okaz zgłosić?',
        message: 'Okazy z tego tygodnia ze zmierzonym kapeluszem – od największego.',
        icon: 'emoji_events',
        actions: [
          ...candidates.slice(0, 4).map((x) => ({
            label: `${speciesById[x.find.speciesId]?.name ?? 'Okaz'} · ${fmtContestScore(c.kind, x.score)}`,
            style: 'default' as const,
            value: x.find.id,
          })),
          { label: 'Anuluj', style: 'cancel' as const, value: null },
        ],
      });
      if (!picked) return;
      findId = picked;
    }
    setBusy(true);
    await enterFindFlow(contests, findId);
    setBusy(false);
  };

  return (
    <View style={{ gap: 6 }}>
      <Button3D title="Zgłoś okaz do walki" icon="add_a_photo" size="md" loading={busy} onPress={() => void enter()} />
      {!candidates.length ? (
        <Txt f="n6" size={12} color={colors.muted} align="center">
          Okaz musi mieć zmierzony kapelusz – zrób zdjęcie z dłonią albo monetą obok.
        </Txt>
      ) : null}
    </View>
  );
}

/* ───────────────────────── Tablica ───────────────────────── */

/**
 * Podpis mojego okazu: miejsce albo powód, dla którego go nie ma – okaz w weryfikacji, z innej gminy / województwa niż
 * zasięg („Pokaż” przełącza zasięg), przed upływem 24 h, gracz w weryfikacji albo ukryty w rankingach.
 */
function MineNote({
  board: b,
  mine,
  now,
  status,
  onScope,
}: {
  board: ContestBoard;
  mine: ContestEntry;
  now: number;
  status?: RivalryStatus;
  onScope: (scope: ContestScope, scopeId: string | null) => void;
}) {
  const gmina = useCatalogStore((s) => (mine.gminaId ? s.gminaById[mine.gminaId] : undefined));
  const outside =
    b.scope === 'gmina'
      ? !!mine.gminaId && !!b.scopeId && mine.gminaId !== b.scopeId
      : b.scope === 'wojewodztwo'
        ? !!gmina && !!b.scopeId && gmina.voivodeship !== b.scopeId
        : false;
  let icon: IconName = 'info';
  let text = 'Okaz nie ma jeszcze miejsca w tym zasięgu.';
  let action: { label: string; onPress: () => void } | null = null;
  if (mine.status === 'review') {
    icon = 'hourglass_top';
    text = 'Okaz jest w weryfikacji – inni go teraz nie widzą.';
  } else if (outside) {
    icon = 'location_on';
    text =
      b.scope === 'gmina'
        ? `Twój okaz walczy w swojej gminie${gmina ? ` (${gminaTitle(gmina)})` : ''}.`
        : `Twój okaz walczy w swoim województwie (${gmina?.voivodeship ?? ''}).`;
    action = {
      label: 'Pokaż',
      onPress: () => onScope(b.scope, b.scope === 'gmina' ? mine.gminaId : (gmina?.voivodeship ?? null)),
    };
  } else if (mine.visibleFrom) {
    icon = 'visibility_off';
    text = `Inni zobaczą go ${fmtVisibleFrom(mine.visibleFrom, now)} – wtedy dostanie miejsce.`;
  } else if (mine.rank != null) {
    icon = 'visibility';
    text = `${mine.rank}. miejsce ${CONTEST_SCOPE_IN[b.scope]}.`;
  } else if (status?.standing === 'review') {
    icon = 'hourglass_top';
    text = 'Twoje wyniki są w weryfikacji – inni ich teraz nie widzą, okaz nie ma miejsca.';
  } else if (b.scope !== 'znajomi' && status && !status.showInRankings) {
    icon = 'visibility_off';
    text = 'Jesteś ukryty w rankingach – okaz walczy tylko wśród znajomych i w pojedynkach.';
    action = { label: 'Ustawienia', onPress: () => router.push('/ustawienia' as Href) };
  }
  return (
    <>
      <Icon name={icon} size={16} color={colors.muted} />
      <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
        {text}
      </Txt>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={8} accessibilityRole="button">
          <Txt f="b7" size={14} color={colors.outlineText}>
            {action.label}
          </Txt>
        </Pressable>
      ) : null}
    </>
  );
}

function BoardView({
  board: b,
  now,
  status,
  onAuthor,
  onScope,
}: {
  board: ContestBoard;
  now: number;
  status?: RivalryStatus;
  onAuthor: (e: ContestEntry) => void;
  onScope: (scope: ContestScope, scopeId: string | null) => void;
}) {
  const { contests } = useServices();
  const c = b.contest;
  const live = b.scope === 'znajomi';
  const mine = b.mine;
  const open = c.status === 'open' && now < Date.parse(c.endsAt);
  const minEntrants = b.scope === 'znajomi' ? null : CONTEST_MIN_ENTRANTS[b.scope];
  const onMore = (e: ContestEntry) => void reportEntryFlow(contests, e.id, e.author.name);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 2 }}>
        <Txt f="b7" size={18} numberOfLines={1} style={{ flex: 1 }}>
          {b.scopeName}
        </Txt>
        <Txt f="n8" size={13} color={colors.primaryText}>
          {okazy(b.total)}
        </Txt>
      </View>

      {mine ? (
        <View style={{ gap: 6 }}>
          <Txt f="n8" size={11} color={colors.muted} upper ls={0.08} style={{ paddingHorizontal: 2 }}>
            Twój okaz
          </Txt>
          <ContestEntryRow entry={mine} kind={c.kind} showGmina={!live} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 }}>
            <MineNote board={b} mine={mine} now={now} status={status} onScope={onScope} />
            {open && mine.status !== 'review' ? (
              <Pressable onPress={() => confirmWithdraw(contests, c)} hitSlop={8} accessibilityRole="button">
                <Txt f="b7" size={14} color={colors.outlineText}>
                  Wycofaj
                </Txt>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {b.entries.length ? (
        <View style={{ gap: 8 }}>
          {b.entries.map((e) => (
            <ContestEntryRow key={e.id} entry={e} kind={c.kind} showGmina={!live} onAuthor={onAuthor} onMore={onMore} />
          ))}
          {b.total > b.entries.length ? (
            <Txt f="n7" size={12} color={colors.muted} align="center">
              … i {okazy(b.total - b.entries.length)} dalej
            </Txt>
          ) : null}
        </View>
      ) : (
        <StateCard
          icon="emoji_events"
          title={
            c.status === 'final' ? 'Nikt tu nie walczył' : live ? 'Znajomi jeszcze nie walczą' : 'Tablica jest jeszcze pusta'
          }
          text={
            c.status === 'final'
              ? 'W tym zasięgu nikt nie zgłosił okazu.'
              : live
                ? 'Wyzwij znajomych – okazy znajomych widać tu od razu.'
                : 'Nikt jeszcze nie zgłosił okazu – Twój może być pierwszy!'
          }
        />
      )}

      <View style={{ gap: 6, paddingHorizontal: 2, paddingTop: 2 }}>
        <Note icon={live ? 'group' : 'schedule'}>
          {live
            ? 'Znajomi widzą swoje okazy od razu – tylko wynik i gatunek, bez gminy.'
            : 'Okazy innych widać po 24 h – tak chronimy miejsca grzybiarzy. Nikt nie widzi lokalizacji dokładniejszej niż gmina.'}
        </Note>
        {minEntrants ? (
          <Note icon="military_tech">
            Podium i nagrody od {minEntrants} uczestników w zasięgu – wyniki 2 dni po końcu tygodnia.
          </Note>
        ) : null}
      </View>
    </View>
  );
}

function Note({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <Icon name={icon} size={16} color={colors.muted} />
      <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
        {children}
      </Txt>
    </View>
  );
}

function PreviousWeekLink({ now }: { now: number }) {
  const prev = lastResolvedWeek(now);
  return (
    <Pressable
      onPress={() => router.push(contestHref(makeContestId(prev, RELATIVE_KEY)))}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 18,
        borderWidth: 2.5,
        borderColor: colors.outline,
        paddingVertical: 11,
        paddingHorizontal: 14,
        backgroundColor: pressed ? colors.outlineHover : 'transparent',
      })}
    >
      <Icon name="history" size={20} color={colors.outlineText} />
      <Txt f="b7" size={15} color={colors.outlineText} style={{ flex: 1 }}>
        Wyniki tygodnia {fmtWeekRange(prev)}
      </Txt>
      <Icon name="chevron_right" size={20} color={colors.outlineText} />
    </Pressable>
  );
}
