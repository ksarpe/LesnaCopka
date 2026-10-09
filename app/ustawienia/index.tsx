import Constants from 'expo-constants';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { LEGAL_HREF, LEGAL_ICON } from '@/components/LegalDocView';
import { RankingVisibilityRow } from '@/components/PlayerRankVisibility';
import { Screen } from '@/components/Screen';
import { SettingsGroup, SettingsRow } from '@/components/Settings';
import { Toggle } from '@/components/Toggle';
import { Txt } from '@/components/Txt';
import { UserAvatar } from '@/components/UserAvatar';
import { DEV_TOOLS } from '@/config';
import { LEGAL_DOCS } from '@/data/legal';
import { useRegionStore } from '@/hooks/useRegion';
import { useServices } from '@/services';
import { getAccountInfo } from '@/services/supabase/account';
import { supabaseEnabled } from '@/services/supabase/client';
import { runExport } from '@/store/account';
import { resetAll } from '@/store/game';
import { requestSync } from '@/store/notify';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useOfflineMapsStore } from '@/store/useOfflineMapsStore';
import { usePrefsStore } from '@/store/usePrefsStore';
import { ui, useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors } from '@/theme/tokens';
import { fmtMB, gminaTitle, plural } from '@/utils/format';
import { levelTitle } from '@/utils/xp';

const VERSION = Constants.expoConfig?.version ?? '–';

/** Ustawienia (z ⚙ w Profilu): konto, powiadomienia, prywatność, aplikacja. */
export default function SettingsScreen() {
  const services = useServices();
  const user = useUserStore((s) => s.user);
  const home = useCatalogStore((s) => s.gminaById[user.homeGminaId]);
  // Nowy gracz: gmina domowa przyjdzie z pierwszego wykrycia GPS (do tego czasu wartość zastępcza – nie pokazujemy jej).
  const homePending = useUserStore((s) => !!s.homeGminaPending);
  const hideRoute = usePrefsStore((s) => s.hideRouteByDefault);
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/profil'));
  const [account, setAccount] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<number | null>(null);
  const offlineAreas = useOfflineMapsStore((s) => s.areas);
  const offlineBytes = offlineAreas.reduce((sum, a) => sum + a.bytes, 0);

  // Stan konta (anonimowe / e-mail) i liczba zablokowanych – przy każdym wejściu (mogły się zmienić na podstronach).
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (supabaseEnabled) {
        getAccountInfo()
          .then((i) => alive && setAccount(i ? (i.anonymous ? 'Konto anonimowe – zabezpiecz je e-mailem' : (i.email ?? '')) : null))
          .catch(() => {});
      }
      services.feed
        .getBlockedUsers()
        .then((l) => alive && setBlocked(l.length))
        .catch(() => alive && setBlocked(null));
      return () => {
        alive = false;
      };
    }, [services]),
  );

  const wipe = () =>
    ui.confirm({
      title: 'Wyczyścić wszystkie dane?',
      message:
        'Usuniemy zmiany w profilu, zdjęcie, wyprawy, znaleziska, wpisy i ustawienia – aplikacja wróci do stanu początkowego. Tego nie da się cofnąć. Mapy offline zostają (Ustawienia › Mapy offline).',
      icon: 'delete_forever',
      confirmLabel: 'Wyczyść dane',
      danger: true,
      onConfirm: () => {
        // Ten sam reset co w panelu /dev (stan gry, ustawienia, zdjęcia) + centrum powiadomień.
        resetAll();
        services.dev?.reset();
        useNotificationStore.getState().reset();
        requestSync();
        useRegionStore.getState().set({ status: 'idle', region: null });
        if (router.canDismiss()) router.dismissAll();
        router.navigate('/');
        setTimeout(() => ui.toast('Dane wyczyszczone – zaczynasz od nowa', 'restart_alt'), 300);
      },
    });

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Ustawienia
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <Card
          radius={22}
          padding={14}
          onPress={() => router.push('/ustawienia/profil' as Href)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}
        >
          <UserAvatar size={58} ringWidth={3} stripe={5} />
          <View style={{ flex: 1 }}>
            <Txt f="b7" size={20} numberOfLines={1}>
              {user.name}
            </Txt>
            <Txt f="n7" size={13} color={colors.muted} numberOfLines={1}>
              {user.handle} · Lv {user.level} {levelTitle(user.level)}
            </Txt>
          </View>
          <Icon name="chevron_right" size={22} color={colors.disabled} />
        </Card>

        <SettingsGroup title="Konto">
          <SettingsRow
            icon="edit"
            label="Edytuj profil"
            sub="Zdjęcie, imię, nick i opis"
            onPress={() => router.push('/ustawienia/profil' as Href)}
          />
          <SettingsRow
            icon="home_pin"
            label="Gmina domowa"
            sub="Twoja drużyna w rankingu gmin"
            value={homePending ? 'Wybierz' : home ? gminaTitle(home) : user.homeGminaId}
            onPress={() => router.push('/ustawienia/gmina' as Href)}
          />
          <SettingsRow
            icon="manage_accounts"
            iconBg={colors.infoBg}
            iconColor={colors.infoText}
            label="Konto i logowanie"
            sub={supabaseEnabled ? (account ?? 'E-mail, logowanie na innym telefonie') : 'Tryb bez serwera – dane tylko na tym telefonie'}
            onPress={() => router.push('/ustawienia/konto' as Href)}
          />
          <SettingsRow
            icon="download"
            iconBg={colors.chip}
            iconColor={colors.tagNeutralText}
            label="Pobierz moje dane"
            sub="Plik JSON ze wszystkim, co o Tobie zapisujemy"
            onPress={() => void runExport()}
          />
          <SettingsRow icon="delete_forever" danger label="Usuń konto" sub="Na zawsze – z serwera i z telefonu" onPress={() => router.push('/ustawienia/usun-konto' as Href)} />
        </SettingsGroup>

        <SettingsGroup title="Powiadomienia">
          <SettingsRow
            icon="notifications"
            iconBg={colors.questHikeBg}
            iconColor={colors.questHikeIcon}
            label="Powiadomienia"
            sub="Co i kiedy możemy Ci przypominać"
            onPress={() => router.push('/ustawienia/powiadomienia' as Href)}
          />
        </SettingsGroup>

        <SettingsGroup
          title="Prywatność"
          footer={
            <View style={{ backgroundColor: colors.primaryTint, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 10 }}>
              <Icon name="shield" filled size={24} color={colors.primaryText} />
              <Txt f="n7" size={13} color={colors.primaryTintBody} style={{ flex: 1 }}>
                Nigdy nie pokazujemy Twojej lokalizacji na żywo. Wpis z wyprawy widzą inni dopiero po 24 h – z dokładnością
                do gminy albo przybliżonej trasy. Gminę wykrywamy na telefonie, a pozycja GPS nie jest nigdzie zapisywana.
              </Txt>
            </View>
          }
        >
          <SettingsRow
            icon="route"
            iconBg={colors.infoBg}
            iconColor={colors.infoText}
            label="Domyślnie ukrywaj trasę"
            sub={hideRoute ? 'Po wyprawie publikujemy tylko gminę' : 'Po wyprawie publikujemy gminę i przybliżoną trasę'}
            right={
              <Toggle
                value={hideRoute}
                onChange={(v) => usePrefsStore.getState().set({ hideRouteByDefault: v })}
                accessibilityLabel="Domyślnie ukrywaj trasę"
              />
            }
          />
          <RankingVisibilityRow />
          <SettingsRow
            icon="block"
            iconBg={colors.chip}
            iconColor={colors.tagNeutralText}
            label={blocked ? `Zablokowani (${blocked})` : 'Zablokowani'}
            sub="Osoby, których wpisów i komentarzy nie widzisz"
            onPress={() => router.push('/ustawienia/zablokowani' as Href)}
          />
        </SettingsGroup>

        <SettingsGroup title="Informacje prawne">
          {LEGAL_DOCS.map((d) => (
            <SettingsRow
              key={d.id}
              icon={LEGAL_ICON[d.id]}
              iconBg={colors.chip}
              iconColor={colors.tagNeutralText}
              label={d.title}
              onPress={() => router.push(LEGAL_HREF[d.id])}
            />
          ))}
        </SettingsGroup>

        <SettingsGroup title="Aplikacja">
          <SettingsRow
            icon="download_for_offline"
            label="Mapy offline"
            sub={
              offlineAreas.length
                ? `${offlineAreas.length} ${plural(offlineAreas.length, 'obszar', 'obszary', 'obszarów')} · ${fmtMB(offlineBytes)}`
                : 'Mapa okolicy w lesie bez zasięgu'
            }
            onPress={() => router.push('/ustawienia/mapy-offline' as Href)}
          />
          {/* Panel symulacji tylko z narzędziami dev (src/config.ts) – w wydaniu wiersza nie ma. */}
          {DEV_TOOLS ? (
            <SettingsRow
              icon="tune"
              iconBg={colors.chip}
              iconColor={colors.tagNeutralText}
              label="Panel symulacji (dev)"
              sub="GPS, sieć, wynik skanu, scenariusze"
              onPress={() => router.push('/dev')}
            />
          ) : null}
          <SettingsRow icon="info" iconBg={colors.chip} iconColor={colors.tagNeutralText} label="O aplikacji" value={`v${VERSION}`} onPress={showAbout} />
          <SettingsRow icon="delete_forever" danger label="Wyczyść dane i zacznij od nowa" onPress={wipe} />
        </SettingsGroup>

        <Txt f="n6" size={12} color={colors.faint} align="center" style={{ marginBottom: 4 }}>
          Grzybobranie {VERSION} · rozpoznanie AI może się mylić – nie jedz grzyba tylko na podstawie aplikacji
        </Txt>
      </View>
    </Screen>
  );
}

function showAbout() {
  useUiStore.getState().showDialog({
    title: 'Grzybobranie',
    icon: 'forest',
    message:
      `Wersja ${VERSION}\n\n` +
      'Gatunek rozpoznaje model AI (Claude, Anthropic) ze zdjęcia wysłanego na serwer – wyłącznie do rozpoznania. ' +
      'Wynik jest orientacyjny i może być błędny. Nigdy nie jedz grzyba tylko na podstawie aplikacji.\n\n' +
      (supabaseEnabled ? '' : 'Ta wersja działa bez serwera – feed i rankingi pokazują dane przykładowe.\n\n') +
      'Granice gmin: PRG – GUGiK (dane otwarte). Lesistość: GUS BDL. Mapa okolicy: © OpenStreetMap (ODbL), ' +
      'kafle OpenFreeMap / OpenMapTiles.\n\nIkony Material Symbols (Apache 2.0), fonty Baloo 2 i Nunito Sans (SIL OFL).',
    actions: [{ label: 'OK', style: 'primary' }],
  });
}
