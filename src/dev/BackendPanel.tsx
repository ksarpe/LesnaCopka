import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { connect } from '@/services/supabase';
import { BACKEND, supabase, SUPABASE_URL } from '@/services/supabase/client';
import { useBackendStatus } from '@/services/supabase/status';
import { colors } from '@/theme/tokens';

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

/** Sekcja „Backend” panelu /dev: tryb, połączenie z Supabase i to, co aplikacja widzi w bazie. */
export function BackendPanel() {
  const status = useBackendStatus();
  const [snap, setSnap] = useState<DbSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      await connect();
      const uid = useBackendStatus.getState().userId;
      const [species, gminy, badges, profiles, me] = await Promise.all([
        count('species'),
        count('gminy'),
        count('badges'),
        count('profiles'),
        uid
          ? supabase.from('profiles').select('handle, level, total_xp').eq('id', uid).maybeSingle().then((r) => r.data)
          : Promise.resolve(null),
      ]);
      setSnap({ species, gminy, badges, profiles, me });
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

  const online = status.state === 'online';
  const tone = !supabase ? colors.muted : online ? colors.primaryText : status.state === 'connecting' ? colors.warnIcon : colors.danger;
  const label = !supabase
    ? 'Mocki (bez bazy)'
    : online
      ? 'Połączono z Supabase'
      : status.state === 'connecting'
        ? 'Łączenie…'
        : 'Brak połączenia z bazą';

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
      {status.userId ? <Row k="Konto (anonimowe)" v={`${status.userId.slice(0, 8)}…`} /> : null}
      {snap?.me ? <Row k="Profil w bazie" v={`@${snap.me.handle} · Lv ${snap.me.level} · ${snap.me.total_xp} XP`} /> : null}
      {snap ? (
        <Row k="W bazie" v={`${snap.species} gatunków · ${snap.gminy} gmin · ${snap.badges} odznak · ${snap.profiles} kont`} />
      ) : null}
      {status.error && !online ? (
        <Txt f="n6" size={12} color={colors.danger}>
          {status.error}
        </Txt>
      ) : null}
      {supabase ? (
        <Txt f="n6" size={12} color={colors.muted}>
          Słowniki (gatunki, odznaki, zadania) i konto są w bazie. Postęp gry jest jeszcze lokalny – kolejny krok to
          przeniesienie akcji gry na funkcje w bazie.
        </Txt>
      ) : (
        <Txt f="n6" size={12} color={colors.muted}>
          Włącz bazę: EXPO_PUBLIC_BACKEND=supabase w .env.local i restart `npx expo start`.
        </Txt>
      )}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <Txt f="n7" size={13} color={colors.muted} style={{ width: 128 }}>
        {k}
      </Txt>
      <Txt f="n7" size={13} style={{ flex: 1 }}>
        {v}
      </Txt>
    </View>
  );
}
