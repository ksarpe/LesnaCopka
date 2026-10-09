import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { ServiceError, useServices } from '@/services';
import { useCatalogStore } from '@/store/useCatalogStore';
import { colors, medals } from '@/theme/tokens';
import type { ContestEligibility, Find } from '@/types';
import { bestPlace, CONTEST_REASONS, contestCheck, fmtContestScore, SCALE_HINT } from '@/utils/contests';
import { Button3D } from './Button3D';
import { useDesignScenario } from './ContestCard';
import { CONTEST_PRIVACY_NOTE, confirmAndEnter, useFindSyncPending } from './ContestEnter';
import { Icon, type IconName } from './Icon';
import { Pill } from './Pill';
import { Txt } from './Txt';

/** Tryb Supabase: znalezisko trafia na serwer kolejką – zanim dotrze, serwer go nie zna (NOT_FOUND). Ponowienia. */
const RETRY_MS = [2000, 4000, 8000];

type Load = { status: 'loading' } | { status: 'ready'; elig: ContestEligibility } | { status: 'error'; text: string };

/**
 * Karta „Walka o okaz” na ekranie Nagroda (ciemne tło). Okaz pasuje → miejsce, które zająłby („Byłby 2.
 * w województwie”), „Zgłoś okaz do walki” z informacją o zdjęciu, potem „Zgłoszony ✓”. Nie pasuje przez brak skali
 * (albo nietypowo duży kapelusz) → krótka podpowiedź; inne powody (kępki, gatunek chroniony…) – bez karty.
 * W stanach z makiety (scenariusze) karty nie ma.
 */
export function ContestRewardCard({ find }: { find: Find }) {
  const design = useDesignScenario();
  const species = useCatalogStore((s) => s.speciesById[find.speciesId]);
  // Warunki z telefonu liczymy raz na znalezisko (ekran Nagroda przerysowuje się w trakcie animacji).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const local = useMemo(() => contestCheck(find, species), [find.id, find.sizeVerified, species]);
  // Tryb Supabase: odbiór nagrody (`find.claim`) idzie kolejką – pytanie o walki wyprzedziłoby go i serwer odpowiedziałby
  // „Najpierw odbierz nagrodę…”. Pytamy dopiero, gdy kolejka wyśle zdarzenia znaleziska (nowy EligibleCard = nowe pytanie).
  const pending = useFindSyncPending(find.id);
  if (design) return null;
  if (!local.ok) {
    if (local.missingScale) return <Hint icon="straighten" text={SCALE_HINT} />;
    if (local.reason === CONTEST_REASONS.tooBig) return <Hint icon="info" text={local.reason} />;
    return null;
  }
  if (pending) return <Hint icon="sync" text="Okaz czeka na wysłanie na serwer – walki tygodnia sprawdzę, gdy dotrze." />;
  return <EligibleCard findId={find.id} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        width: '100%',
        backgroundColor: 'rgba(255,255,255,0.08)',
        borderRadius: 22,
        paddingVertical: 14,
        paddingHorizontal: 16,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name="emoji_events" filled size={18} color={medals[0]} />
        <Txt f="n8" size={11} color={colors.tipIcon} upper ls={0.08}>
          Walka o okaz
        </Txt>
      </View>
      {children}
    </View>
  );
}

function Hint({ icon, text }: { icon: IconName; text: string }) {
  return (
    <Shell>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <Icon name={icon} size={20} color={colors.onDarkSoft} />
        <Txt f="n7" size={13} color={colors.onDarkSoft} style={{ flex: 1 }}>
          {text}
        </Txt>
      </View>
    </Shell>
  );
}

function EligibleCard({ findId }: { findId: string }) {
  const { contests } = useServices();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      try {
        const elig = await contests.getContestEligibility(findId);
        if (alive) setLoad({ status: 'ready', elig });
      } catch (e) {
        if (!alive) return;
        const code = e instanceof ServiceError ? e.code : null;
        if (code === 'NOT_FOUND' && tries < RETRY_MS.length) {
          timer = setTimeout(run, RETRY_MS[tries++]);
          return;
        }
        setLoad({
          status: 'error',
          text:
            code === 'NOT_FOUND'
              ? 'Okaz jeszcze się wysyła – zgłosisz go do walki z dziennika znalezisk (Profil → kafel „grzybów”).'
              : code && code !== 'NETWORK'
                ? (e as ServiceError).message
                : 'Bez zasięgu – zgłosisz okaz do walki z dziennika znalezisk, gdy wróci sieć.',
        });
      }
    };
    void run();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [contests, findId]);

  if (load.status === 'loading') {
    return (
      <Shell>
        <Txt f="n7" size={13} color={colors.onDarkMuted}>
          Sprawdzam walki tygodnia…
        </Txt>
      </Shell>
    );
  }
  if (load.status === 'error') return <Hint icon="cloud_off" text={load.text} />;
  const { elig } = load;
  if (!elig.eligible || !elig.contests.length) {
    return <Hint icon="info" text={elig.reason ?? 'Walki tego tygodnia są już zamknięte.'} />;
  }

  const entered = elig.contests.every((m) => m.entered);
  const place = bestPlace(elig.contests[0].projectedRank).text;
  const enter = async () => {
    setBusy(true);
    const after = await confirmAndEnter(contests, elig, { askFirst: false });
    setBusy(false);
    if (after) setLoad({ status: 'ready', elig: after });
  };

  return (
    <Shell>
      {entered ? (
        <Pill
          label="Zgłoszony ✓"
          icon="check_circle"
          iconFilled
          bg="rgba(127,181,71,0.22)"
          color={colors.xpOnDark}
          size={14}
          padV={6}
          padH={12}
        />
      ) : (
        <Txt f="b7" size={20} lh={1.2} color={colors.onDark}>
          Twój okaz byłby {place}!
        </Txt>
      )}
      <View style={{ gap: 3 }}>
        {elig.contests.map((m) => (
          <View key={m.contest.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Txt f="n7" size={13} color={colors.onDark} style={{ flex: 1 }} numberOfLines={1}>
              {m.contest.title}
            </Txt>
            <Txt f="n8" size={13} color={colors.xpOnDark}>
              {fmtContestScore(m.contest.kind, m.score)}
            </Txt>
          </View>
        ))}
      </View>
      {entered ? (
        <Txt f="n7" size={12} color={colors.onDarkMuted}>
          Teraz byłby {place} – inni zobaczą okaz po 24 h. Tablice i wyniki: ekran Rywalizacja (zakładka Gminy).
        </Txt>
      ) : (
        <>
          <Button3D
            title="Zgłoś okaz do walki"
            icon="emoji_events"
            size="md"
            onDark
            loading={busy}
            onPress={() => void enter()}
          />
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Icon name="visibility" size={16} color={colors.onDarkMuted} />
            <Txt f="n6" size={12} color={colors.onDarkMuted} style={{ flex: 1 }}>
              {CONTEST_PRIVACY_NOTE}
            </Txt>
          </View>
        </>
      )}
      {!elig.prizeEligible ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Icon name="mail_lock" size={16} color={colors.tipIcon} />
          <Txt f="n6" size={12} color={colors.onDarkSoft} style={{ flex: 1 }}>
            Nagrody XP za podium – po zabezpieczeniu konta e-mailem (Ustawienia → Konto).
          </Txt>
        </View>
      ) : null}
    </Shell>
  );
}
