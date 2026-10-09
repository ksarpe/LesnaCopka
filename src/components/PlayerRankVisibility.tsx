import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { ServiceError, useServices } from '@/services';
import { ui } from '@/store/useUiStore';
import { colors } from '@/theme/tokens';
import type { RivalryStatus } from '@/types';
import { SettingsRow } from './Settings';
import { Toggle } from './Toggle';

const LABEL = 'Pokazuj mnie w rankingach grzybiarzy i walkach';

/**
 * Ustawienia → Prywatność: widoczność w rankingu grzybiarzy i na tablicach walk o okaz w zasięgach publicznych
 * (DuelService.getRivalryStatus / setRankingVisibility – `profiles.show_in_rankings`). Ukryty gracz nadal rywalizuje
 * ze znajomymi i w pojedynkach. Stan z serwera przy każdym wejściu; zmiana od razu w UI, przy błędzie – cofnięta.
 */
export function RankingVisibilityRow() {
  const { duels } = useServices();
  const [status, setStatus] = useState<RivalryStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Wersja stanu: zapis przełącznika unieważnia odczyt w toku (starszy stan z serwera nie cofa zmiany). */
  const version = useRef(0);

  const load = useCallback(() => {
    let alive = true;
    const v = version.current;
    duels
      .getRivalryStatus()
      .then((s) => {
        if (!alive || v !== version.current) return;
        setStatus(s);
        setFailed(false);
      })
      .catch(() => alive && v === version.current && setFailed(true));
    return () => {
      alive = false;
    };
  }, [duels]);
  useFocusEffect(load);

  const change = async (visible: boolean) => {
    if (!status || saving) return;
    const prev = status;
    version.current += 1;
    setStatus({ ...status, showInRankings: visible });
    setSaving(true);
    try {
      await duels.setRankingVisibility(visible);
      ui.toast(visible ? 'Znów pokazujemy Cię w rankingach i walkach' : 'Ukryliśmy Cię w rankingach i walkach', visible ? 'visibility' : 'visibility_off');
    } catch (e) {
      setStatus(prev);
      const network = !(e instanceof ServiceError) || e.code === 'NETWORK';
      ui.toast(network ? 'Brak połączenia – nie udało się zmienić widoczności' : e.message, network ? 'wifi_off' : 'error');
    } finally {
      // Odczyt rozpoczęty w trakcie zapisu mógł zobaczyć stan sprzed niego – też do pominięcia.
      version.current += 1;
      setSaving(false);
    }
  };

  const sub = status
    ? status.showInRankings
      ? 'Ranking grzybiarzy i tablice walk o okaz w gminie, województwie i Polsce'
      : 'Ukryty: widzą Cię tylko znajomi, a Twoje okazy walczą tylko wśród znajomych i w pojedynkach'
    : failed
      ? 'Brak połączenia – stuknij, żeby spróbować ponownie'
      : 'Wczytywanie…';

  return (
    <SettingsRow
      icon={status && !status.showInRankings ? 'visibility_off' : 'military_tech'}
      iconBg={colors.warnBg}
      iconColor={colors.warnIcon}
      label={LABEL}
      sub={sub}
      onPress={!status && failed ? () => void load() : undefined}
      right={status ? <Toggle value={status.showInRankings} onChange={(v) => void change(v)} accessibilityLabel={LABEL} /> : undefined}
    />
  );
}
