import { Redirect, router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Card } from '@/components/Card';
import { DEV_TOOLS } from '@/config';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Screen } from '@/components/Screen';
import { Toggle } from '@/components/Toggle';
import { Txt } from '@/components/Txt';
import { BackendPanel } from '@/dev/BackendPanel';
import { NotificationsPanel } from '@/dev/NotificationsPanel';
import { devSimulateWalk } from '@/dev/simWalk';
import { useRegionStore } from '@/hooks/useRegion';
import { useServices } from '@/services';
import { devScanSimulatesSigned, identifyAvailable } from '@/services/live/identify';
import type { PermissionKind, PermissionStatus } from '@/services/types';
import {
  addDistance,
  devAddXp,
  devDiscoverSpecies,
  devUnlockBadge,
  loadScenario,
  resetAll,
  setTimeSpeed,
  type Scenario,
} from '@/store/game';
import { devShowOnboarding } from '@/store/onboarding';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useFeedSync } from '@/store/useFeedSync';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSimStore } from '@/store/useSimStore';
import { useActiveTrip } from '@/store/useTripStore';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, rarity as rarityTokens } from '@/theme/tokens';
import type { ScanForce } from '@/utils/identify';

const CORE = ['suprasl', 'michalowo', 'hajnowka', 'narewka', 'grodek'];

const SCAN_FORCE: { v: ScanForce; l: string }[] = [
  { v: 'off', l: 'Wyłączone (prawdziwe rozpoznanie)' },
  { v: 'species', l: 'Gatunek' },
  { v: 'not_mushroom', l: 'Nie grzyb' },
  { v: 'unclear', l: 'Niewyraźne' },
];

/** W wydaniu (bez EXPO_PUBLIC_DEV_TOOLS=1) panelu nie ma – także pod linkiem `grzybobranie://dev`. */
export default function DevRoute() {
  if (!DEV_TOOLS) return <Redirect href="/" />;
  return <DevPanel />;
}

function DevPanel() {
  const services = useServices();
  const sim = useSimStore();
  const trip = useActiveTrip();
  const gminaById = useCatalogStore((s) => s.gminaById);
  const species = useCatalogStore((s) => s.species);
  const badges = useCatalogStore((s) => s.badges);
  const unlocked = useUserStore((s) => s.badges);
  const home = useUserStore((s) => s.user.homeGminaId);

  const close = () => (router.canGoBack() ? router.back() : router.navigate('/'));

  const scenario = (s: Scenario, label: string) => {
    const id = loadScenario(s);
    services.dev?.reset({ emptyFeed: s === 'newUser' });
    useFeedSync.getState().invalidate();
    useRegionStore.getState().set({ status: 'idle', region: null });
    ui.toast(`Wczytano: ${label}`, 'restart_alt');
    // Po zmianie `onboarded` układ najpierw przelicza dostępne ekrany (Stack.Protected) – nawigujemy chwilę później.
    setTimeout(() => {
      // Nowy użytkownik → onboarding (panel /dev zastępujemy ekranem powitalnym).
      if (!useUserStore.getState().onboarded) {
        router.replace('/onboarding');
        return;
      }
      if (router.canDismiss()) router.dismissAll();
      if (s === 'designSummary' && id) router.push(`/summary/${id}`);
      else router.navigate('/');
    }, 50);
  };

  const showOnboarding = () => {
    devShowOnboarding();
    ui.toast('Onboarding od początku', 'waving_hand');
    setTimeout(() => router.replace('/onboarding'), 50);
  };

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Txt f="b7" size={30}>
              Panel symulacji
            </Txt>
            <Txt f="n7" size={13} color={colors.muted}>
              Steruje mockami serwisów · tylko prototyp
            </Txt>
          </View>
          <IconButton icon="close" onPress={close} accessibilityLabel="Zamknij panel" />
        </View>

        <BackendPanel />

        <Section title="Scenariusze" icon="restart_alt">
          <Chips>
            <Chip label="Start (domyślny)" onPress={() => scenario('start', 'start')} />
            <Chip label="Nowy użytkownik" onPress={() => scenario('newUser', 'nowy użytkownik')} />
            <Chip label="Makieta: wyprawa trwa" onPress={() => scenario('designActive', 'aktywna wyprawa z makiety')} />
            <Chip label="Makieta: podsumowanie" onPress={() => scenario('designSummary', 'podsumowanie z makiety')} />
            <Chip label="Onboarding (bez resetu)" onPress={showOnboarding} />
          </Chips>
          <Txt f="n6" size={12} color={colors.muted}>
            „Nowy użytkownik” zaczyna od onboardingu (dev-link: ?scenario=newUser&onboarding=0 go pomija). Na ekranie
            onboardingu „Pomiń (dev)” w prawym górnym rogu.
          </Txt>
        </Section>

        <Section title="Lokalizacja" icon="my_location">
          <Label>Źródło pozycji</Label>
          <Chips>
            <Chip
              label="GPS urządzenia"
              active={sim.locationSource === 'device'}
              onPress={() => sim.set({ locationSource: 'device' })}
            />
            <Chip label="Symulacja" active={sim.locationSource === 'sim'} onPress={() => sim.set({ locationSource: 'sim' })} />
          </Chips>
          {sim.locationSource === 'device' ? (
            <Txt f="n6" size={12} color={colors.muted}>
              Prawdziwy GPS (expo-location) i gmina wykryta na urządzeniu z granic PRG. Zgodę na lokalizację
              nadaje system – zmienisz ją w ustawieniach telefonu / przeglądarki.
            </Txt>
          ) : (
            <>
              <Row label="GPS włączony" hint="Wyłączony → „Włącz lokalizację, aby rozpocząć” na ekranie Start">
                <Toggle value={sim.gpsEnabled} onChange={(v) => sim.set({ gpsEnabled: v })} />
              </Row>
              <Label>Gmina</Label>
              <Chips>
                <Chip
                  label={`Domowa (${gminaById[home]?.name ?? '—'})`}
                  active={sim.forcedGminaId == null}
                  onPress={() => sim.set({ forcedGminaId: null })}
                />
                {CORE.filter((id) => id !== home).map((id) => (
                  <Chip
                    key={id}
                    label={gminaById[id]?.name ?? id}
                    active={sim.forcedGminaId === id}
                    onPress={() => sim.set({ forcedGminaId: id })}
                  />
                ))}
              </Chips>
              <Label>Punkt</Label>
              <Chips>
                <Chip label="W gminie" active={sim.simPoint === 'gmina'} onPress={() => sim.set({ simPoint: 'gmina' })} />
                <Chip
                  label="Słaby GPS (±1,5 km)"
                  active={sim.simPoint === 'coarse'}
                  onPress={() => sim.set({ simPoint: 'coarse' })}
                />
                <Chip
                  label="Za granicą"
                  active={sim.simPoint === 'abroad'}
                  onPress={() => sim.set({ simPoint: 'abroad' })}
                />
              </Chips>
              <PermissionRow kind="location" label="Zgoda: lokalizacja" />
            </>
          )}
          <Label>Aparat</Label>
          <Chips>
            <Chip
              label="Aparat urządzenia"
              active={sim.cameraSource === 'device'}
              onPress={() => sim.set({ cameraSource: 'device' })}
            />
            <Chip label="Symulacja" active={sim.cameraSource === 'sim'} onPress={() => sim.set({ cameraSource: 'sim' })} />
          </Chips>
          {sim.cameraSource === 'device' ? (
            <Txt f="n6" size={12} color={colors.muted}>
              Prawdziwy podgląd w skanie (expo-camera). Telefon z czujnikami ruchu robi skan 3D: obejście grzyba, seria
              ujęć i analiza sama po zapełnieniu grzybka; bez czujników (web) – zdjęcie spustem. Zgodę nadaje system;
              bez kamery (np. komputer) skan pokazuje „Brak aparatu” z wyborem zdjęcia z galerii (tylko dev).
            </Txt>
          ) : (
            <>
              <Txt f="n6" size={12} color={colors.muted}>
                Paskowany podgląd i symulowane obchodzenie grzyba (skan 3D bez zdjęć, ~11 s) – bez wymuszonego wyniku
                kończy się „Brak aparatu”.
              </Txt>
              <PermissionRow kind="camera" label="Zgoda: aparat" />
            </>
          )}
        </Section>

        <Section title="Sieć" icon="wifi">
          <Row
            label="Połączenie z siecią"
            hint="Offline → stany błędów w Feedzie, Gminach, Analizie i publikacji; mapa okolicy tylko z kafli na telefonie (mapy offline, pamięć podręczna)"
          >
            <Toggle value={sim.networkEnabled} onChange={(v) => sim.set({ networkEnabled: v })} />
          </Row>
        </Section>

        <Section title="Wynik skanu (dev)" icon="center_focus_strong">
          <Txt f="n6" size={12} color={colors.muted}>
            {identifyAvailable()
              ? 'Domyślnie zdjęcie rozpoznaje serwer (Edge Function identify → Claude). '
              : 'Brak adresu serwera w konfiguracji – bez wymuszenia skan kończy się komunikatem „Rozpoznawanie wymaga połączenia z serwerem”. '}
            Wymuszony wynik zastępuje rozpoznanie: nie wysyła zdjęcia, działa bez aparatu i sieci, nic nie kosztuje.
          </Txt>
          <Label>Wymuś wynik skanu</Label>
          <Chips>
            {SCAN_FORCE.map((o) => (
              <Chip key={o.v} label={o.l} active={sim.scan.force === o.v} onPress={() => sim.setScan({ force: o.v })} />
            ))}
          </Chips>
          {sim.scan.force === 'species' ? (
            <>
              <Label>Gatunek</Label>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: 8 }}>
                {species.map((s, i) => (
                  <Chip
                    key={s.id}
                    label={s.name.replace(/ \(.*\)$/, '')}
                    dot={rarityTokens[s.rarity].color}
                    active={sim.scan.speciesId === s.id || (sim.scan.speciesId == null && i === 0)}
                    onPress={() => sim.setScan({ speciesId: s.id })}
                  />
                ))}
              </ScrollView>
              <Row label="Okaz XXL" hint="Wymiary jak z odniesieniem skali na zdjęciu (×1,35 typowych); kępki – bez XXL">
                <Toggle value={sim.scan.xxl} onChange={(v) => sim.setScan({ xxl: v })} />
              </Row>
              <Row label="Niska pewność (<60%)" hint="Ekran „Nie jestem pewien” z możliwymi gatunkami">
                <Toggle value={sim.scan.lowConfidence} onChange={(v) => sim.setScan({ lowConfidence: v })} />
              </Row>
              <Row
                label="Z odniesieniem skali (kapelusz zmierzony)"
                hint={
                  devScanSimulatesSigned()
                    ? 'Tryb mock: symulacja podpisanego rozpoznania – znalezisko zweryfikowane i zmierzone (walki o okaz)'
                    : 'Tryb Supabase: wynik wymuszony zawsze niezweryfikowany (serwer nie ma jego rozpoznania) – poza rankingami i walkami'
                }
              >
                <Toggle value={!!sim.scan.scaleRef} onChange={(v) => sim.setScan({ scaleRef: v })} />
              </Row>
            </>
          ) : null}
        </Section>

        <Section title="Wyprawa" icon="hiking">
          <Label>Upływ czasu</Label>
          <Chips>
            <Chip label="×1" active={sim.timeSpeed === 1} onPress={() => setTimeSpeed(1)} />
            <Chip label="×10" active={sim.timeSpeed === 10} onPress={() => setTimeSpeed(10)} />
          </Chips>
          <Label>{trip ? 'Dodaj dystans' : 'Dodaj dystans (najpierw rozpocznij wyprawę)'}</Label>
          <Chips>
            {[0.5, 1, 5].map((km) => (
              <Chip
                key={km}
                label={`+${String(km).replace('.', ',')} km`}
                disabled={!trip}
                onPress={() => {
                  addDistance(km);
                  ui.toast(`+${String(km).replace('.', ',')} km`, 'hiking');
                }}
              />
            ))}
          </Chips>
          <Label>Symuluj spacer – dystans i trasa (Podsumowanie pokaże ją na mapie)</Label>
          <Chips>
            {[0.5, 2, 5].map((km) => (
              <Chip
                key={km}
                label={`Spacer ${String(km).replace('.', ',')} km`}
                disabled={!trip}
                onPress={() =>
                  devSimulateWalk(km).then((ok) =>
                    ui.toast(ok ? `Spacer +${String(km).replace('.', ',')} km dopisany do trasy` : 'Brak punktu startu spaceru', 'route'),
                  )
                }
              />
            ))}
          </Chips>
        </Section>

        <Section title="Postęp" icon="military_tech">
          <Label>Dodaj XP (sprawdź LEVEL UP)</Label>
          <Chips>
            {[100, 500, 1000].map((xp) => (
              <Chip key={xp} label={`+${xp} XP`} onPress={() => devAddXp(xp)} />
            ))}
          </Chips>
          <Label>Odblokuj odznakę</Label>
          <Chips>
            {badges.map((b) => (
              <Chip
                key={b.id}
                label={b.name}
                active={unlocked.includes(b.id)}
                onPress={() => {
                  devUnlockBadge(b.id);
                  ui.toast(`Odznaka: ${b.name}`, 'military_tech');
                }}
              />
            ))}
          </Chips>
          <Label>Osiągnięcia (odkryj losowe gatunki z katalogu)</Label>
          <Chips>
            {[1, 3, 10].map((k) => (
              <Chip key={k} label={`+${k} ${k === 1 ? 'gatunek' : k < 5 ? 'gatunki' : 'gatunków'}`} onPress={() => devDiscoverSpecies(k)} />
            ))}
          </Chips>
        </Section>

        <NotificationsPanel />

        <Pressable
          onPress={() =>
            ui.confirm({
              title: 'Zresetować cały stan?',
              message: 'Usuniemy wyprawy, postęp, wpisy i ustawienia symulacji. Tego nie da się cofnąć.',
              icon: 'restart_alt',
              confirmLabel: 'Resetuj wszystko',
              danger: true,
              onConfirm: () => {
                resetAll();
                services.dev?.reset();
                // Feed (zakładka zostaje zamontowana) pobierze wpisy, znajomych i komentarze od nowa.
                useFeedSync.getState().invalidate();
                useNotificationStore.getState().reset();
                useRegionStore.getState().set({ status: 'idle', region: null });
                if (router.canDismiss()) router.dismissAll();
                router.navigate('/');
                setTimeout(() => ui.toast('Stan zresetowany', 'restart_alt'), 300);
              },
            })
          }
          style={({ pressed }) => ({
            borderWidth: 2.5,
            borderColor: colors.dangerBorder,
            backgroundColor: pressed ? colors.dangerBg : 'transparent',
            borderRadius: 20,
            padding: 14,
            marginBottom: 8,
          })}
        >
          <Txt f="b7" size={17} color={colors.danger} align="center">
            Reset całego stanu
          </Txt>
        </Pressable>
      </View>
    </Screen>
  );
}

function Section({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <Card radius={22} padding={16} gap={10}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} filled size={20} color={colors.primaryText} />
        <Txt f="b7" size={18}>
          {title}
        </Txt>
      </View>
      {children}
    </Card>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <Txt f="n8" size={11} color={colors.muted} upper ls={0.08} style={{ marginTop: 2 }}>
      {children}
    </Txt>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={14}>
          {label}
        </Txt>
        {hint ? (
          <Txt f="n6" size={12} color={colors.muted}>
            {hint}
          </Txt>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Chips({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{children}</View>;
}

function Chip({
  label,
  active,
  onPress,
  disabled,
  dot,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  dot?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: active ? colors.ink : colors.canvas,
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 12,
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      {dot ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: dot }} /> : null}
      <Txt f="n8" size={13} color={active ? colors.bg : colors.ink}>
        {label}
      </Txt>
    </Pressable>
  );
}

function PermissionRow({ kind, label }: { kind: PermissionKind; label: string }) {
  const status = useSimStore((s) => s.permissions[kind]);
  const setPermission = useSimStore((s) => s.setPermission);
  const opts: { v: PermissionStatus; l: string }[] = [
    { v: 'undetermined', l: 'Nie pytano' },
    { v: 'granted', l: 'Zgoda' },
    { v: 'denied', l: 'Odmowa' },
  ];
  return (
    <>
      <Label>{label}</Label>
      <Chips>
        {opts.map((o) => (
          <Chip key={o.v} label={o.l} active={status === o.v} onPress={() => setPermission(kind, o.v)} />
        ))}
      </Chips>
    </>
  );
}
