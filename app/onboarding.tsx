import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Avatar } from '@/components/Avatar';
import { AvatarPresetGrid } from '@/components/AvatarPresetGrid';
import { Button3D } from '@/components/Button3D';
import { CheckRow } from '@/components/Checkbox';
import { EmailCodeFlow } from '@/components/EmailCodeFlow';
import { GminaPicker } from '@/components/GminaPicker';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { LEGAL_HREF, LEGAL_ICON } from '@/components/LegalDocView';
import { Screen } from '@/components/Screen';
import { SettingsGroup, SettingsRow } from '@/components/Settings';
import { TextField } from '@/components/TextField';
import { Txt } from '@/components/Txt';
import { DEV_TOOLS } from '@/config';
import { fmtLegalDate, LEGAL_DOCS, LEGAL_VERSION, SAFETY_NOTICE, SAFETY_RULES } from '@/data/legal';
import { useBottomPadding } from '@/hooks/useInsets';
import { detectRegion, useRegionStore } from '@/hooks/useRegion';
import { useServices } from '@/services';
import { sendLoginCode } from '@/services/supabase/account';
import { supabaseEnabled } from '@/services/supabase/client';
import type { PermissionKind } from '@/services/types';
import { confirmPendingSync, loginWithEmailCode } from '@/store/account';
import { requestNotificationPermission } from '@/store/notify';
import { completeOnboarding, devSkipOnboarding } from '@/store/onboarding';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useSimStore } from '@/store/useSimStore';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, rarity as rarityTokens } from '@/theme/tokens';
import type { UserAvatar } from '@/types';
import { gminaTitle } from '@/utils/format';
import {
  EMPTY_DRAFT,
  isLastStep,
  nextStep,
  ONBOARDING_STEPS,
  prevStep,
  profileFields,
  stepBlocker,
  stepIndex,
  type OnboardingDraft,
  type OnboardingStep,
} from '@/utils/onboarding';
import { handleBody, handleError, HANDLE_MAX, nameError, NAME_MAX, normalizeHandle } from '@/utils/profile';

/**
 * Onboarding (pierwsze uruchomienie, nowe konto): powitanie → bezpieczeństwo → regulamin → profil → gmina domowa →
 * uprawnienia. Pokazuje go app/_layout.tsx, dopóki `useUserStore.onboarded` jest false – zakładki są wtedy niedostępne.
 * Logika kroków: src/utils/onboarding.ts, zapis: src/store/onboarding.ts.
 */
export default function OnboardingScreen() {
  const user = useUserStore((s) => s.user);
  const bottom = useBottomPadding();
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [draft, setDraft] = useState<OnboardingDraft>(EMPTY_DRAFT);
  const [mode, setMode] = useState<'steps' | 'login'>('steps');
  const [checking, setChecking] = useState(false);
  const [handleTaken, setHandleTaken] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const { feed } = useServices();

  const patch = (p: Partial<OnboardingDraft>) => setDraft((d) => ({ ...d, ...p }));
  const blocker = stepBlocker(step, draft, user);
  const index = stepIndex(step);

  const go = (s: OnboardingStep) => {
    setStep(s);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const goBack = () => (mode === 'login' ? setMode('steps') : go(prevStep(step)));

  // Android: „wstecz” cofa o krok (na pierwszym kroku – zwykłe zachowanie systemu).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode === 'steps' && index === 0) return false;
      goBack();
      return true;
    });
    return () => sub.remove();
  });

  /** Nick zajęty przez kogoś innego? Sprawdzamy przed przejściem dalej (bez sieci – sprawdzi serwer przy zapisie). */
  const handleFree = async (): Promise<boolean> => {
    const h = normalizeHandle(profileFields(draft, user).handle);
    if (h === user.handle) return true;
    setChecking(true);
    try {
      const other = await feed.getUserByHandle(h);
      if (other && other.id !== user.id) {
        setHandleTaken('Ten nick jest już zajęty – wybierz inny');
        return false;
      }
      return true;
    } catch {
      return true;
    } finally {
      setChecking(false);
    }
  };

  const finish = () => {
    try {
      const u = completeOnboarding(draft);
      setTimeout(() => ui.toast(`Witaj, ${u.firstName || u.name}! Darz grzyb!`, 'forest'), 400);
    } catch {
      ui.toast('Uzupełnij wszystkie kroki', 'error');
    }
  };

  const next = async () => {
    if (blocker || checking) return;
    if (step === 'profile' && !(await handleFree())) return;
    if (isLastStep(step)) finish();
    else go(nextStep(step));
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingTop: 6, paddingHorizontal: 20, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {mode === 'login' || index > 0 ? (
            <IconButton icon="arrow_back" onPress={goBack} accessibilityLabel="Wstecz" />
          ) : (
            <View style={{ width: 44, height: 44 }} />
          )}
          <View style={{ flex: 1, alignItems: 'center' }}>{mode === 'steps' ? <Dots index={index} /> : null}</View>
          {DEV_TOOLS ? (
            <Pressable
              onPress={devSkipOnboarding}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => ({ width: 44, alignItems: 'flex-end', opacity: pressed ? 0.6 : 1 })}
            >
              <Txt f="n8" size={12} color={colors.faint}>
                Pomiń (dev)
              </Txt>
            </Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 18 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          {mode === 'login' ? (
            <LoginStep onDone={() => setMode('steps')} />
          ) : (
            <Animated.View key={step} entering={FadeIn.duration(220)} style={{ gap: 18 }}>
              {step === 'welcome' ? <WelcomeStep onLogin={supabaseEnabled ? () => setMode('login') : undefined} /> : null}
              {step === 'safety' ? <SafetyStep draft={draft} patch={patch} /> : null}
              {step === 'terms' ? <TermsStep draft={draft} patch={patch} /> : null}
              {step === 'profile' ? (
                <ProfileStep
                  draft={draft}
                  patch={(p) => {
                    if ('handle' in p) setHandleTaken(null);
                    patch(p);
                  }}
                  taken={handleTaken}
                />
              ) : null}
              {step === 'gmina' ? <GminaStep draft={draft} patch={patch} /> : null}
              {step === 'permissions' ? <PermissionsStep /> : null}
            </Animated.View>
          )}
        </ScrollView>

        {mode === 'steps' ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: bottom, gap: 8, backgroundColor: colors.bg }}>
            {/* Profil pokazuje błędy pod polami – tu tylko, dopóki gracz niczego nie zmienił. */}
            {blocker && (step !== 'profile' || (draft.name == null && draft.handle == null)) ? (
              <Txt f="n7" size={12} color={colors.muted} align="center">
                {blocker}
              </Txt>
            ) : null}
            <Button3D
              title={checking ? 'Sprawdzam nick…' : isLastStep(step) ? 'Zaczynamy!' : 'Dalej'}
              icon={isLastStep(step) ? 'forest' : 'arrow_forward'}
              onPress={() => void next()}
              disabled={!!blocker || checking}
            />
            {isLastStep(step) ? (
              <Pressable onPress={finish} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: 'center', paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}>
                <Txt f="b7" size={15} color={colors.outlineText}>
                  Później – włączę w Ustawieniach
                </Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

/* ───────────────────────── Elementy wspólne ───────────────────────── */

function Dots({ index }: { index: number }) {
  return (
    <View
      style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}
      accessibilityLabel={`Krok ${index + 1} z ${ONBOARDING_STEPS.length}`}
      accessibilityRole="progressbar"
    >
      {ONBOARDING_STEPS.map((s, i) => (
        <View
          key={s}
          style={{
            width: i === index ? 22 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i <= index ? colors.primary : colors.ringTrack,
          }}
        />
      ))}
    </View>
  );
}

/** Duża ilustracja kroku: koło w kolorze z palety z ikoną i dwiema „kropkami” dookoła. */
function Hero({ icon, bg, fg, title, text }: { icon: IconName; bg: string; fg: string; title: string; text?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 12, paddingTop: 4 }}>
      <View style={{ width: 132, height: 132, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 4, top: 14, width: 18, height: 18, borderRadius: 9, backgroundColor: bg, opacity: 0.7 }} />
        <View style={{ position: 'absolute', right: 2, bottom: 16, width: 12, height: 12, borderRadius: 6, backgroundColor: fg, opacity: 0.35 }} />
        <View style={{ width: 112, height: 112, borderRadius: 56, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} filled size={60} color={fg} />
        </View>
      </View>
      <Txt f="b7" size={28} lh={1.15} align="center" accessibilityRole="header">
        {title}
      </Txt>
      {text ? (
        <Txt f="n6" size={15} color={colors.muted} align="center" lh={1.45}>
          {text}
        </Txt>
      ) : null}
    </View>
  );
}

function Feature({ icon, color, title, text }: { icon: IconName; color: string; title: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} filled size={26} color={colors.white} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Txt f="n8" size={16}>
          {title}
        </Txt>
        <Txt f="n6" size={13} color={colors.muted}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

function Bullets({ items, color = colors.bodyDark }: { items: readonly string[]; color?: string }) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((t) => (
        <View key={t} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 8 }} />
          <Txt f="n6" size={14} lh={1.45} color={color} style={{ flex: 1 }}>
            {t}
          </Txt>
        </View>
      ))}
    </View>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <View style={{ backgroundColor: colors.card, borderRadius: 22, padding: 16, gap: 14 }}>{children}</View>;
}

/* ───────────────────────── Kroki ───────────────────────── */

function WelcomeStep({ onLogin }: { onLogin?: () => void }) {
  return (
    <>
      <Hero
        icon="forest"
        bg={colors.primary}
        fg={colors.primaryInk}
        title="Witaj w Grzybobraniu!"
        text="Gra i dziennik grzybiarza. W lesie działa także bez zasięgu."
      />
      <Panel>
        <Feature
          icon="photo_camera"
          color={rarityTokens.rzadki.color}
          title="Skanuj grzyby"
          text="Skan 360° podpowie gatunek, rozmiar i groźne sobowtóry."
        />
        <Feature
          icon="menu_book"
          color={rarityTokens.legendarny.color}
          title="Zbieraj XP i gatunki do atlasu"
          text="Odznaki, osiągnięcia i poziomy za każdą wyprawę."
        />
        <Feature
          icon="emoji_events"
          color={rarityTokens.epicki.color}
          title="Rywalizuj gminami"
          text="Twoja gmina walczy w rankingu – bez ujawniania miejscówek."
        />
      </Panel>
      {onLogin ? (
        <Pressable
          onPress={onLogin}
          accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
        >
          <Icon name="login" size={20} color={colors.outlineText} />
          <Txt f="b7" size={16} color={colors.outlineText}>
            Już masz konto? Zaloguj się kodem z e-maila
          </Txt>
        </Pressable>
      ) : null}
    </>
  );
}

function SafetyStep({ draft, patch }: { draft: OnboardingDraft; patch: (p: Partial<OnboardingDraft>) => void }) {
  return (
    <>
      <Hero icon="health_and_safety" bg={colors.warnBg} fg={colors.warnIcon} title="Najpierw bezpieczeństwo" />
      <View style={{ backgroundColor: colors.warnBg, borderWidth: 2, borderColor: colors.warnBorder, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 12 }}>
        <Icon name="warning" filled size={26} color={colors.warnIcon} />
        <View style={{ flex: 1, gap: 6 }}>
          <Txt f="n8" size={15} color={colors.warnTitle}>
            {SAFETY_NOTICE.title}
          </Txt>
          <Txt f="n6" size={14} lh={1.45} color={colors.warnText}>
            {SAFETY_NOTICE.text}
          </Txt>
        </View>
      </View>
      <Bullets items={SAFETY_RULES} />
      <View style={{ backgroundColor: colors.infoBg, borderRadius: 18, padding: 12, flexDirection: 'row', gap: 10 }}>
        <Icon name="info" filled size={22} color={colors.infoText} />
        <Txt f="n7" size={13} color={colors.infoText} style={{ flex: 1 }}>
          Rozpoznawanie gatunków działa na razie w trybie demonstracyjnym – wynik skanu jest elementem gry, a nie analizą
          zdjęcia.
        </Txt>
      </View>
      <CheckRow
        checked={draft.safetyAck}
        onChange={(v) => patch({ safetyAck: v })}
        label="Rozumiem – aplikacja nie decyduje, czy grzyb jest jadalny"
      />
    </>
  );
}

function TermsStep({ draft, patch }: { draft: OnboardingDraft; patch: (p: Partial<OnboardingDraft>) => void }) {
  return (
    <>
      <Hero
        icon="policy"
        bg={colors.infoBg}
        fg={colors.infoText}
        title="Regulamin i prywatność"
        text="Najważniejsze w skrócie – całość przeczytasz poniżej i zawsze w Ustawieniach."
      />
      <Panel>
        <Bullets
          items={[
            'Dokładna lokalizacja zostaje na telefonie – na serwer trafia tylko gmina.',
            'Wpis z wyprawy inni widzą po 24 h, bez dokładnej trasy.',
            'Konto jest anonimowe – e-mail podajesz tylko, jeśli chcesz zabezpieczyć konto.',
            'Swoje dane pobierzesz i usuniesz w Ustawieniach, a uciążliwe osoby zablokujesz.',
          ]}
        />
      </Panel>
      <SettingsGroup
        footer={
          <Txt f="n6" size={12} color={colors.muted} style={{ paddingHorizontal: 4 }}>
            Wersja z {fmtLegalDate(LEGAL_VERSION)}
          </Txt>
        }
      >
        {LEGAL_DOCS.map((d) => (
          <SettingsRow
            key={d.id}
            icon={LEGAL_ICON[d.id]}
            iconBg={colors.chip}
            iconColor={colors.tagNeutralText}
            label={d.title}
            sub="Przeczytaj całość"
            onPress={() => router.push(LEGAL_HREF[d.id])}
          />
        ))}
      </SettingsGroup>
      <CheckRow
        checked={draft.termsAccepted}
        onChange={(v) => patch({ termsAccepted: v })}
        label="Akceptuję regulamin i politykę prywatności"
      />
      <CheckRow
        checked={draft.ageConfirmed}
        onChange={(v) => patch({ ageConfirmed: v })}
        label="Mam ukończone 16 lat"
        sub="Młodsi mogą grać tylko za zgodą rodzica lub opiekuna prawnego."
      />
    </>
  );
}

function ProfileStep({
  draft,
  patch,
  taken,
}: {
  draft: OnboardingDraft;
  patch: (p: Partial<OnboardingDraft>) => void;
  taken: string | null;
}) {
  const user = useUserStore((s) => s.user);
  const f = profileFields(draft, user);
  const avatar: UserAvatar | undefined = draft.avatar === undefined ? user.avatar : (draft.avatar ?? undefined);
  // Błędy dopiero po zmianie pola (nie straszymy na wejściu).
  const nameErr = draft.name != null ? nameError(f.name) : null;
  const handleErr = taken ?? (draft.handle != null ? handleError(f.handle) : null);
  return (
    <>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Avatar size={104} ringWidth={4} stripe={7} avatar={avatar} />
        <Txt f="b7" size={28} lh={1.15} align="center" accessibilityRole="header">
          Jak mają Cię widzieć inni?
        </Txt>
      </View>
      <TextField
        label="Imię lub pseudonim"
        value={f.name}
        onChangeText={(t) => patch({ name: t })}
        error={nameErr}
        hint="Widoczne dla innych – możesz użyć pseudonimu"
        placeholder="np. Kuba albo Leśny Dziadek"
        maxLength={NAME_MAX}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="nickname"
      />
      <TextField
        label="Nick"
        prefix="@"
        value={f.handle}
        // Nick zawsze małymi literami i bez spacji; „@” jest stałym przedrostkiem pola.
        onChangeText={(t) => patch({ handle: handleBody(t).replace(/\s/g, '') })}
        error={handleErr}
        hint="3–20 znaków: litery a–z, cyfry, kropka i podkreślnik – po nim znajdą Cię znajomi"
        placeholder="kuba.grzyb"
        maxLength={HANDLE_MAX}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        textContentType="none"
        spellCheck={false}
      />
      <Panel>
        <View style={{ gap: 2 }}>
          <Txt f="b7" size={17}>
            Motyw avatara
          </Txt>
          <Txt f="n6" size={12} color={colors.muted}>
            Zdjęcie dodasz później w Ustawieniach → Edytuj profil
          </Txt>
        </View>
        <AvatarPresetGrid
          selectedId={avatar?.kind === 'preset' ? avatar.id : null}
          onSelect={(id) => patch({ avatar: avatar?.kind === 'preset' && avatar.id === id ? null : { kind: 'preset', id } })}
          size={50}
        />
      </Panel>
    </>
  );
}

function GminaStep({ draft, patch }: { draft: OnboardingDraft; patch: (p: Partial<OnboardingDraft>) => void }) {
  const services = useServices();
  const locating = useRegionStore((s) => s.status === 'loading');
  const gmina = useCatalogStore((s) => (draft.homeGminaId ? s.gminaById[draft.homeGminaId] : undefined));

  const locate = async () => {
    const region = await detectRegion(services, { askPermission: true });
    if (region) {
      patch({ homeGminaId: region.gmina.id });
      ui.toast(`Jesteś w gminie ${gminaTitle(region.gmina)}`, 'my_location');
    } else {
      const err = useRegionStore.getState().error;
      ui.toast(err?.message ? `${err.message} – wyszukaj gminę` : 'Nie udało się ustalić gminy – wyszukaj ją', 'location_off');
    }
  };

  return (
    <>
      <Hero
        icon="home_pin"
        bg={colors.primaryTint}
        fg={colors.primaryText}
        title="Twoja gmina domowa"
        text="Twoja drużyna w rankingu gmin i feed „Moja gmina”. Zmienisz ją w każdej chwili w Ustawieniach."
      />
      <Button3D
        title={locating ? 'Szukam Twojej gminy…' : 'Użyj mojej lokalizacji'}
        icon="my_location"
        size="md"
        onPress={() => void locate()}
        disabled={locating}
      />
      <Txt f="n6" size={12} color={colors.muted} align="center">
        Gminę wykrywamy na telefonie – Twoja pozycja nie trafia na serwer.
      </Txt>
      {gmina ? (
        <Txt f="n8" size={14} color={colors.primaryText} align="center">
          Wybrana: {gminaTitle(gmina)}
        </Txt>
      ) : null}
      <GminaPicker selectedId={draft.homeGminaId} selectedTitle="Wybrana" onSelect={(o) => patch({ homeGminaId: o.id })} />
    </>
  );
}

function PermissionsStep() {
  const services = useServices();
  const location = useSimStore((s) => s.permissions.location);
  const camera = useSimStore((s) => s.permissions.camera);
  const notif = useNotificationStore((s) => s.permission);

  const ask = async (kind: PermissionKind) => {
    const current = services.permissions.get(kind);
    const st = current === 'denied' ? await services.permissions.openSettings?.(kind) : await services.permissions.request(kind);
    if (st === 'granted') ui.toast(kind === 'location' ? 'Lokalizacja włączona' : 'Aparat włączony', 'check_circle');
  };

  return (
    <>
      <Hero
        icon="verified_user"
        bg={colors.primaryTint}
        fg={colors.primaryText}
        title="Uprawnienia"
        text="Włącz teraz albo później – zapytamy też wtedy, gdy będą potrzebne."
      />
      <PermissionCard
        icon="my_location"
        title="Lokalizacja"
        text="Wykrywa gminę i liczy dystans wyprawy – tylko gdy aplikacja jest otwarta. Dokładna pozycja zostaje na telefonie."
        state={location}
        onEnable={() => void ask('location')}
      />
      <PermissionCard
        icon="photo_camera"
        title="Aparat"
        text="Do skanu grzyba i zdjęć znalezisk. Zdjęcia zapisujemy bez metadanych (także bez położenia)."
        state={camera}
        onEnable={() => void ask('camera')}
      />
      <PermissionCard
        icon="notifications_active"
        title="Powiadomienia"
        text={
          notif === 'unsupported'
            ? 'W tej wersji powiadomienia zobaczysz w centrum powiadomień w aplikacji.'
            : 'Przypomnienie o serii, reakcje znajomych i nowe wyzwania gmin. Bez reklam.'
        }
        state={notif === 'unsupported' ? 'unsupported' : notif}
        onEnable={() =>
          void (notif === 'denied' ? Promise.resolve() : requestNotificationPermission()).then((p) => {
            if (p === 'granted') ui.toast('Powiadomienia włączone', 'notifications_active');
            else if (notif === 'denied') ui.toast('Włącz powiadomienia w ustawieniach telefonu', 'settings');
          })
        }
      />
    </>
  );
}

function PermissionCard({
  icon,
  title,
  text,
  state,
  onEnable,
}: {
  icon: IconName;
  title: string;
  text: string;
  state: 'undetermined' | 'granted' | 'denied' | 'unsupported';
  onEnable: () => void;
}) {
  const granted = state === 'granted';
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 22, padding: 14, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          backgroundColor: granted ? colors.primary : colors.primaryTint,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} filled size={24} color={granted ? colors.primaryInk : colors.primaryText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt f="n8" size={15}>
          {title}
        </Txt>
        <Txt f="n6" size={12} color={colors.muted}>
          {text}
        </Txt>
      </View>
      {granted ? (
        <Icon name="check_circle" filled size={26} color={colors.primary} />
      ) : state === 'unsupported' ? null : (
        <Pressable
          onPress={onEnable}
          accessibilityRole="button"
          accessibilityLabel={`${state === 'denied' ? 'Ustawienia' : 'Włącz'}: ${title}`}
          style={({ pressed }) => ({
            borderRadius: 999,
            paddingVertical: 8,
            paddingHorizontal: 14,
            backgroundColor: pressed ? colors.primaryShadow : colors.primary,
          })}
        >
          <Txt f="b7" size={14} color={colors.primaryInk}>
            {state === 'denied' ? 'Ustawienia' : 'Włącz'}
          </Txt>
        </Pressable>
      )}
    </View>
  );
}

/* ───────────────────────── Logowanie (tryb Supabase) ───────────────────────── */

function LoginStep({ onDone }: { onDone: () => void }) {
  const services = useServices();
  const verify = async (email: string, code: string) => {
    if (!(await confirmPendingSync())) return false;
    const r = await loginWithEmailCode(services, email, code);
    if (r.error) throw r.error;
    const u = useUserStore.getState();
    if (!r.hydrated && !r.sameAccount) {
      ui.toast('Zalogowano – postępy pobiorą się po połączeniu z serwerem', 'cloud_off');
    } else if (u.onboarded) {
      // Konto z zakończonym onboardingiem – układ sam przełączy na zakładki.
      setTimeout(() => ui.toast(`Witaj z powrotem, ${u.user.firstName || u.user.name}!`, 'forest'), 400);
    } else {
      ui.toast('Zalogowano – dokończ konfigurację konta', 'login');
    }
    onDone();
    return true;
  };
  return (
    <>
      <Hero
        icon="login"
        bg={colors.infoBg}
        fg={colors.infoText}
        title="Zaloguj się kodem z e-maila"
        text="Masz konto zabezpieczone adresem e-mail? Wyślemy na niego kod – Twoje postępy wrócą na ten telefon."
      />
      <Panel>
        <EmailCodeFlow purpose="login" send={sendLoginCode} verify={verify} onCancel={onDone} />
      </Panel>
    </>
  );
}
