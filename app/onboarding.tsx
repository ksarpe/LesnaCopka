import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button3D } from '@/components/Button3D';
import { EmailCodeFlow } from '@/components/EmailCodeFlow';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { LEGAL_HREF } from '@/components/LegalDocView';
import { Screen } from '@/components/Screen';
import { Txt } from '@/components/Txt';
import { DEV_TOOLS } from '@/config';
import { SAFETY_NOTICE } from '@/data/legal';
import { useBottomPadding } from '@/hooks/useInsets';
import { useServices } from '@/services';
import { sendLoginCode } from '@/services/supabase/account';
import { supabaseEnabled } from '@/services/supabase/client';
import { confirmPendingSync, loginWithEmailCode } from '@/store/account';
import { completeOnboarding, devSkipOnboarding } from '@/store/onboarding';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, rarity as rarityTokens } from '@/theme/tokens';
import { ONBOARDING_CONSENT, ONBOARDING_CTA } from '@/utils/onboarding';

/**
 * Onboarding (pierwsze uruchomienie, nowe konto): JEDEN ekran i jedno dotknięcie do zakładek – powitanie, najważniejsza
 * zasada bezpieczeństwa i „Zaczynamy!” z oświadczeniem tuż nad przyciskiem (regulamin, polityka prywatności, 16 lat –
 * src/utils/onboarding.ts). Bez pól wyboru i bez kroków profilu / gminy: nick i imię zostają domyślne (zmiana
 * w Ustawieniach → Edytuj profil), gminę domową przyjmuje pierwsze wykrycie GPS na Starcie. O zgody systemowe pytamy
 * dopiero, gdy są potrzebne: lokalizacja – Start (karta „Włącz lokalizację” / start wyprawy), aparat – skan,
 * powiadomienia – po obserwowaniu gminy i w Ustawieniach. Z serwerem – też logowanie kodem z e-maila na istniejące konto.
 * Pokazuje go app/_layout.tsx, dopóki `useUserStore.onboarded` jest false. Zapis: src/store/onboarding.ts.
 */
export default function OnboardingScreen() {
  const bottom = useBottomPadding();
  const [mode, setMode] = useState<'welcome' | 'login'>('welcome');

  // Android: „wstecz” z logowania wraca do powitania (na powitaniu – zwykłe zachowanie systemu).
  useEffect(() => {
    if (mode !== 'login') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setMode('welcome');
      return true;
    });
    return () => sub.remove();
  }, [mode]);

  const start = () => {
    completeOnboarding();
    const u = useUserStore.getState().user;
    setTimeout(() => ui.toast(`Witaj, ${u.firstName || u.name}! Darz grzyb!`, 'forest'), 400);
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingTop: 6, paddingHorizontal: 20, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', minHeight: 50 }}>
          {mode === 'login' ? <IconButton icon="arrow_back" onPress={() => setMode('welcome')} accessibilityLabel="Wstecz" /> : null}
          <View style={{ flex: 1 }} />
          {DEV_TOOLS ? (
            <Pressable
              onPress={devSkipOnboarding}
              hitSlop={8}
              accessibilityRole="button"
              style={({ pressed }) => ({ alignItems: 'flex-end', opacity: pressed ? 0.6 : 1 })}
            >
              <Txt f="n8" size={12} color={colors.faint}>
                Pomiń (dev)
              </Txt>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 0, paddingBottom: 16, gap: 16 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View key={mode} entering={FadeIn.duration(220)} style={{ gap: 16 }}>
            {mode === 'login' ? <LoginStep onDone={() => setMode('welcome')} /> : <Welcome />}
          </Animated.View>
        </ScrollView>

        {mode === 'welcome' ? (
          <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: bottom, gap: 10, backgroundColor: colors.bg }}>
            <Consent />
            <Button3D title={`${ONBOARDING_CTA}!`} icon="forest" onPress={start} />
            {supabaseEnabled ? (
              <Pressable
                onPress={() => setMode('login')}
                accessibilityRole="button"
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4, opacity: pressed ? 0.6 : 1 })}
              >
                <Icon name="login" size={18} color={colors.outlineText} />
                <Txt f="b7" size={15} color={colors.outlineText}>
                  Mam już konto – zaloguj się kodem z e-maila
                </Txt>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

/* ───────────────────────── Elementy ───────────────────────── */

/** Duża ilustracja: koło w kolorze z palety z ikoną i dwiema „kropkami” dookoła. */
function Hero({ icon, bg, fg, title, text }: { icon: IconName; bg: string; fg: string; title: string; text?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <View style={{ width: 100, height: 100, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: 2, top: 10, width: 14, height: 14, borderRadius: 7, backgroundColor: bg, opacity: 0.7 }} />
        <View style={{ position: 'absolute', right: 2, bottom: 12, width: 10, height: 10, borderRadius: 5, backgroundColor: fg, opacity: 0.35 }} />
        <View style={{ width: 86, height: 86, borderRadius: 43, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} filled size={46} color={fg} />
        </View>
      </View>
      <Txt f="b7" size={27} lh={1.15} align="center" accessibilityRole="header">
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
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} filled size={24} color={colors.white} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Txt f="n8" size={15}>
          {title}
        </Txt>
        <Txt f="n6" size={13} color={colors.muted}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <View style={{ backgroundColor: colors.card, borderRadius: 22, padding: 16, gap: 14 }}>{children}</View>;
}

function Welcome() {
  return (
    <>
      <Hero
        icon="forest"
        bg={colors.primary}
        fg={colors.primaryInk}
        title="Witaj w Grzybobraniu!"
        text="Gra i dziennik grzybiarza. W lesie działa także bez zasięgu."
      />
      {/* Zaraz pod powitaniem – widoczna bez przewijania, obok oświadczenia, które ją obejmuje. */}
      <SafetyNotice />
      <Panel>
        <Feature
          icon="photo_camera"
          color={rarityTokens.rzadki.color}
          title="Skanuj grzyby"
          text="Zdjęcie grzyba podpowie gatunek i groźne sobowtóry."
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
    </>
  );
}

/**
 * Najważniejsza zasada bezpieczeństwa (SAFETY_NOTICE – ta sama ramka otwiera regulamin). Bez osobnego pola „Rozumiem”:
 * oświadczenie przy „Zaczynamy!” obejmuje regulamin z zasadami bezpieczeństwa (§ 4 – link pod ramką).
 */
function SafetyNotice() {
  return (
    <View style={{ backgroundColor: colors.warnBg, borderWidth: 2, borderColor: colors.warnBorder, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 12 }}>
      <Icon name="warning" filled size={26} color={colors.warnIcon} />
      <View style={{ flex: 1, gap: 6 }}>
        <Txt f="n8" size={15} color={colors.warnTitle} accessibilityRole="header">
          {SAFETY_NOTICE.title}
        </Txt>
        <Txt f="n6" size={14} lh={1.45} color={colors.warnText}>
          {SAFETY_NOTICE.text}
        </Txt>
        <Txt f="n6" size={13} lh={1.4} color={colors.warnText}>
          Gatunek rozpoznaje model AI ze zdjęcia wysłanego na serwer – wynik może być błędny.
        </Txt>
        <Pressable
          onPress={() => router.push(LEGAL_HREF.regulamin)}
          accessibilityRole="link"
          accessibilityLabel="Zasady bezpieczeństwa – paragraf 4 regulaminu"
          hitSlop={6}
          style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}
        >
          <Txt f="n8" size={13} color={colors.warnTitle} style={{ textDecorationLine: 'underline' }}>
            Zasady bezpieczeństwa – § 4 regulaminu
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

/** Oświadczenie nad przyciskiem – linki otwierają pełne dokumenty (dostępne też w trakcie onboardingu). */
function Consent() {
  return (
    <Txt f="n6" size={12} lh={1.45} color={colors.muted} align="center">
      {ONBOARDING_CONSENT.map((p) =>
        p.doc ? (
          <Txt
            key={p.text}
            f="n8"
            size={12}
            lh={1.45}
            color={colors.outlineText}
            accessibilityRole="link"
            onPress={() => router.push(LEGAL_HREF[p.doc!])}
            style={{ textDecorationLine: 'underline' }}
          >
            {p.text}
          </Txt>
        ) : (
          p.text
        ),
      )}
    </Txt>
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
      ui.toast(`Zalogowano – jeszcze tylko „${ONBOARDING_CTA}!”`, 'login');
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
