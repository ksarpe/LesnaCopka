import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { StateCard } from '@/components/OfflineCard';
import { areaStatusText } from '@/components/OfflineMaps';
import { ProgressBar } from '@/components/ProgressBar';
import { Screen } from '@/components/Screen';
import { SettingsGroup, SettingsRow } from '@/components/Settings';
import { StatTile } from '@/components/StatTile';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import {
  CACHE_CAP_BYTES,
  cancelOfflineDownload,
  clearMapCache,
  deleteOfflineArea,
  offlineStorageKind,
  retryOfflineArea,
  syncOfflineAreas,
  useOfflineMapsStore,
  useTileUsage,
  type OfflineArea,
} from '@/store/useOfflineMapsStore';
import { useSimStore } from '@/store/useSimStore';
import { ui } from '@/store/useUiStore';
import { colors } from '@/theme/tokens';
import { fmtMB } from '@/utils/format';

const CACHE_CAP_LABEL = fmtMB(CACHE_CAP_BYTES);

/**
 * Ustawienia → Mapy offline: pobrane obszary (rozmiar, data, stan, usuwanie, ponowienie), zajęte miejsce,
 * „Wyczyść pamięć podręczną map” i podpis danych OSM. Mapy offline nie znikają po „Wyczyść dane”.
 */
export default function OfflineMapsScreen() {
  const { map } = useServices();
  const areas = useOfflineMapsStore((s) => s.areas);
  const jobs = useOfflineMapsStore((s) => s.jobs);
  const network = useSimStore((s) => s.networkEnabled);
  const usage = useTileUsage();
  const storage = useAsync(offlineStorageKind, []);
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/ustawienia' as Href));

  // Stan obszarów zgodny z dyskiem przy każdym wejściu (np. przeglądarka wyczyściła dane strony).
  useFocusEffect(
    useCallback(() => {
      void syncOfflineAreas();
    }, []),
  );

  const remove = (a: OfflineArea) =>
    ui.confirm({
      title: `Usunąć „${a.name}”?`,
      message: 'Mapa tego obszaru zniknie z telefonu – bez zasięgu nie zobaczysz w nim lasów. Pobierzesz ją ponownie z mapy.',
      icon: 'delete',
      confirmLabel: 'Usuń',
      danger: true,
      onConfirm: async () => {
        await deleteOfflineArea(a.id);
        ui.toast(`Usunięto mapę: ${a.name}`, 'delete');
      },
    });

  const clearCache = () =>
    ui.confirm({
      title: 'Wyczyścić pamięć podręczną map?',
      message:
        'Usuniemy zapisane przy okazji fragmenty map z ostatnio oglądanych okolic. Pobrane mapy offline zostają.',
      icon: 'cleaning_services',
      confirmLabel: 'Wyczyść',
      onConfirm: async () => {
        const freed = await clearMapCache();
        ui.toast(freed ? `Zwolniono ${fmtMB(freed)}` : 'Pamięć podręczna map jest pusta', 'cleaning_services');
      },
    });

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Mapy offline
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <View style={{ backgroundColor: colors.primaryTint, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 10 }}>
          <Icon name="download_for_offline" filled size={24} color={colors.primaryText} />
          <Txt f="n7" size={13} color={colors.primaryTintBody} style={{ flex: 1 }}>
            W lesie często nie ma zasięgu. Pobrana mapa pokaże lasy, drogi leśne i wodę także offline. Pobierzesz ją
            z mapy okolicy (przycisk w prawym górnym rogu) albo z ekranu gminy. Gmina i lesistość działają bez sieci zawsze.
          </Txt>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <StatTile value={fmtMB(usage.pinnedBytes)} label="mapy offline" valueSize={22} radius={16} />
          <StatTile value={fmtMB(usage.cacheBytes)} label="pamięć podręczna" valueSize={22} radius={16} />
        </View>

        {areas.length === 0 ? (
          <StateCard
            icon="download_for_offline"
            title="Nie masz jeszcze map offline"
            text="Przed wyjściem do lasu otwórz mapę okolicy i pobierz okolicę albo całą gminę."
            action="Otwórz mapę"
            onAction={() => router.push('/mapa')}
          />
        ) : (
          <SettingsGroup title="Pobrane obszary">
            {areas.map((a) => (
              <AreaRow
                key={a.id}
                area={a}
                job={jobs[a.id]}
                network={network}
                onDelete={() => remove(a)}
                onCancel={() => void cancelOfflineDownload(a.id)}
                onRetry={() => void retryOfflineArea(map, a.id)}
              />
            ))}
          </SettingsGroup>
        )}

        <SettingsGroup title="Pamięć podręczna">
          <SettingsRow
            icon="cleaning_services"
            iconBg={colors.chip}
            iconColor={colors.tagNeutralText}
            label="Wyczyść pamięć podręczną map"
            sub={`${fmtMB(usage.cacheBytes)} · ostatnio oglądane okolice, maks. ${CACHE_CAP_LABEL}`}
            onPress={clearCache}
          />
        </SettingsGroup>

        <View style={{ gap: 6, paddingHorizontal: 4, paddingBottom: 8 }}>
          {storage.data === 'memory' ? (
            <Txt f="n7" size={12} color={colors.warnText}>
              Ta przeglądarka nie zapisuje map na stałe – mapy offline znikną po zamknięciu karty.
            </Txt>
          ) : null}
          <Txt f="n6" size={12} color={colors.muted}>
            Dane mapy © OpenStreetMap contributors (licencja ODbL), kafle OpenFreeMap / OpenMapTiles. Pobieramy tylko
            obszary, które wybierzesz – po kilka kafli naraz, żeby nie obciążać darmowego serwera.
          </Txt>
          <Txt f="n6" size={12} color={colors.muted}>
            Mapy offline zostają po „Wyczyść dane” – usuniesz je tylko tutaj. Zapisujemy obszar z dokładnością do kafla
            mapy (ok. 3 km), nie Twoją pozycję.
          </Txt>
        </View>
      </View>
    </Screen>
  );
}

function AreaRow({
  area,
  job,
  network,
  onDelete,
  onCancel,
  onRetry,
}: {
  area: OfflineArea;
  job?: { total: number; done: number; failed: number; bytes: number };
  network: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const downloading = !!job || area.status === 'downloading';
  const partial = !downloading && area.status === 'partial';
  return (
    <View style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: partial ? colors.warnBg : colors.primaryTint,
          }}
        >
          <Icon
            name={partial ? 'warning' : area.kind === 'gmina' ? 'home_pin' : 'my_location'}
            filled
            size={22}
            color={partial ? colors.warnIcon : colors.primaryText}
          />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Txt f="n8" size={15} numberOfLines={1}>
            {area.name}
          </Txt>
          <Txt f="n6" size={12} color={partial ? colors.warnText : colors.muted}>
            {areaStatusText(area, job)}
          </Txt>
        </View>
        {downloading ? (
          <RowAction icon="close" label="Anuluj pobieranie" onPress={onCancel} />
        ) : (
          <>
            {partial && network ? <RowAction icon="refresh" label="Ponów pobieranie" onPress={onRetry} /> : null}
            <RowAction icon="delete" label={`Usuń ${area.name}`} onPress={onDelete} danger />
          </>
        )}
      </View>
      {downloading ? <ProgressBar value={job && job.total ? job.done / job.total : 0} height={8} animated /> : null}
    </View>
  );
}

function RowAction({ icon, label, onPress, danger }: { icon: 'close' | 'refresh' | 'delete'; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.outlineHover : colors.chip,
      })}
    >
      <Icon name={icon} size={20} color={danger ? colors.danger : colors.tagNeutralText} />
    </Pressable>
  );
}
