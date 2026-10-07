/**
 * Dev-linki (tylko web + __DEV__): `?scenario=…` ustawia stan i ekran – do porównań
 * zrzutów z makietą i szybkiego testowania. Przykłady:
 *   /?scenario=start                 01 (idle)
 *   /?scenario=designActive          01 (wyprawa trwa – liczby z makiety)
 *   /?scenario=scan&scanAt=0.68      02 (skan zatrzymany na 68%)
 *   /?scenario=designAnalysis        03 (borowik XXL z makiety)
 *   /?scenario=designReward          04 (nagroda z makiety)
 *   /?scenario=designSummary         05 (podsumowanie z makiety)
 *   /?scenario=start&path=/gminy     dowolna ścieżka po wczytaniu scenariusza
 *   /?scenario=newUser               onboarding (nowy gracz); &onboarding=0 – od razu Start nowego gracza
 *   /?onboarding=1                   onboarding na bieżącym stanie (bez scenariusza); onboarding=0 – pomija go
 * Nadpisania symulacji (łączą się ze scenariuszem):
 *   src=device (prawdziwy GPS; domyślnie symulacja – powtarzalne zrzuty) · point=coarse|abroad
 *   camSrc=device (prawdziwy aparat; domyślnie paskowany placeholder z makiety)
 *   gps=0 · net=0 · loc=denied|undetermined · cam=denied|undetermined
 *   species=<id> · rarity=<rzadkość> · xxl=1|0 · poison=1 · low=1 · xp=<XP w poziomie>
 * Prognoza grzybowa: pozycja z symulacji nie pyta Open-Meteo – Supraśl ma stałą prognozę z makiety
 * („Prognoza grzybowa 4/5”, „2 dni po deszczu”), patrz src/services/mock/weather.ts.
 */
import { router } from 'expo-router';

import { useRegionStore } from '@/hooks/useRegion';
import type { Services } from '@/services/types';
import { claimFind, createPendingFind, loadScenario, type Scenario } from '@/store/game';
import { devShowOnboarding, devSkipOnboarding } from '@/store/onboarding';
import { useSimStore } from '@/store/useSimStore';
import { useUserStore } from '@/store/useUserStore';
import type { Identification, Rarity } from '@/types';

const DESIGN_FIND: Identification = {
  speciesId: 'borowik-szlachetny',
  confidence: 0.96,
  rarity: 'rzadki',
  xxl: true,
  dimensions: { capCm: 14, heightCm: 17, weightG: 410, ageDays: 5 },
  lookalikes: [],
  candidates: [{ speciesId: 'borowik-szlachetny', confidence: 0.96 }],
};

const BASE: Record<string, Scenario> = {
  start: 'start',
  newUser: 'newUser',
  designActive: 'designActive',
  designSummary: 'designSummary',
  designAnalysis: 'designActive',
  designReward: 'designActive',
  scan: 'designActive',
};

export async function applyDevLink(params: URLSearchParams, services: Services) {
  const scenario = params.get('scenario');
  const onboarding = params.get('onboarding');
  if (!scenario || !BASE[scenario]) {
    if (onboarding === '1') devShowOnboarding();
    if (onboarding === '0') devSkipOnboarding();
    return;
  }
  const tripId = loadScenario(BASE[scenario]);
  // Scenariusz „Nowy użytkownik” zaczyna od onboardingu, pozostałe go pomijają – chyba że link mówi inaczej.
  if (onboarding === '1') devShowOnboarding();
  if (onboarding === '0') devSkipOnboarding();
  services.dev?.reset({ emptyFeed: scenario === 'newUser' });
  useRegionStore.getState().set({ status: 'idle', region: null });

  // Nadpisania symulacji.
  const sim = useSimStore.getState();
  const p = (k: string) => params.get(k);
  sim.set({
    locationSource: p('src') === 'device' ? 'device' : 'sim',
    cameraSource: p('camSrc') === 'device' ? 'device' : 'sim',
  });
  if (p('point') === 'coarse' || p('point') === 'abroad') sim.set({ simPoint: p('point') as 'coarse' });
  if (p('scanAt')) sim.set({ scanFreezeAt: Number(p('scanAt')) });
  if (p('gps') === '0') sim.set({ gpsEnabled: false });
  if (p('net') === '0') sim.set({ networkEnabled: false });
  if (p('loc')) sim.setPermission('location', p('loc') as 'denied');
  if (p('cam')) sim.setPermission('camera', p('cam') as 'denied');
  const overrides = !!(p('species') || p('rarity') || p('xxl') || p('poison') || p('low'));
  if (overrides) {
    sim.setScan({
      speciesId: p('species'),
      rarity: (p('rarity') as Rarity) ?? null,
      xxl: p('xxl') == null ? null : p('xxl') === '1',
      poisonous: p('poison') === '1',
      lowConfidence: p('low') === '1',
    });
  }
  if (p('xp')) {
    const u = useUserStore.getState();
    u.patch({ user: { ...u.user, xp: Number(p('xp')) } });
  }

  let href: string | null = p('path');
  if (scenario === 'designSummary' && tripId) href = `/summary/${tripId}`;
  if (scenario === 'scan') href = '/scan';
  if (scenario === 'designAnalysis' || scenario === 'designReward') {
    const ident = overrides ? await services.identify.identify(services.scan.capturePartial(['cap', 'underside', 'stem', 'base'])) : DESIGN_FIND;
    const find = createPendingFind(ident, 'suprasl');
    href = scenario === 'designAnalysis' ? `/analysis/${find.id}` : `/reward/${claimFind(find.id)?.id}`;
  }
  if (href) setTimeout(() => router.push(href as never), 300);
}
