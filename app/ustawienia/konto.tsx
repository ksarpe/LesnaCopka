import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { Button3D } from '@/components/Button3D';
import { Card } from '@/components/Card';
import { EmailCodeFlow } from '@/components/EmailCodeFlow';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Screen } from '@/components/Screen';
import { SettingsGroup, SettingsRow } from '@/components/Settings';
import { Txt } from '@/components/Txt';
import { useServices } from '@/services';
import { confirmLinkCode, getAccountInfo, sendLinkCode, sendLoginCode, type AccountInfo } from '@/services/supabase/account';
import { supabase, supabaseEnabled } from '@/services/supabase/client';
import { confirmPendingSync, loginWithEmailCode, signOut } from '@/store/account';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors } from '@/theme/tokens';

/** Ustawienia → Konto i logowanie: stan konta, zabezpieczenie e-mailem, logowanie na inne konto, wylogowanie. */
export default function AccountScreen() {
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/ustawienia' as Href));
  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Konto i logowanie
          </Txt>
          <View style={{ width: 44 }} />
        </View>
        {supabaseEnabled ? <ServerAccount /> : <OfflineAccount />}
      </View>
    </Screen>
  );
}

/** Tryb bez serwera (mock): konto istnieje tylko w telefonie. */
function OfflineAccount() {
  return (
    <StatusCard
      icon="cloud_off"
      tone={{ bg: colors.infoBg, fg: colors.infoText }}
      title="Konto działa z backendem Supabase"
      text="Ta wersja aplikacji działa bez serwera – postępy są zapisane tylko na tym telefonie. Zabezpieczenie konta e-mailem i logowanie kodem na innym telefonie są dostępne, gdy aplikacja jest połączona z serwerem."
    />
  );
}

type Flow = null | { kind: 'link' } | { kind: 'login'; email?: string };

function ServerAccount() {
  const services = useServices();
  const [info, setInfo] = useState<AccountInfo | null | undefined>(undefined);
  const [flow, setFlow] = useState<Flow>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getAccountInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);
  useFocusEffect(load);
  // Zmiana sesji (kod z e-maila, wylogowanie) – stan konta od nowa.
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'USER_UPDATED' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') load();
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const linked = async (email: string, code: string) => {
    const next = await confirmLinkCode(email, code);
    setInfo(next);
    setFlow(null);
    ui.toast('Konto zabezpieczone – tym adresem zalogujesz się na innym telefonie', 'verified_user');
  };

  /** Kod logowania wpisany → potwierdzenie → zmiana konta. `false` = gracz się wycofał. */
  const login = async (email: string, code: string): Promise<boolean> => {
    const anonymous = info?.anonymous !== false;
    const ok = await ui.choose({
      title: 'Zalogować się na inne konto?',
      message:
        'Postępy z tego telefonu zastąpi stan konta ' +
        email +
        (anonymous
          ? '. Obecne konto anonimowe (bez adresu e-mail) zostanie usunięte – nie da się do niego wrócić.'
          : '. Na obecne konto wrócisz, logując się jego adresem.'),
      icon: 'switch_account',
      actions: [
        { label: 'Anuluj', style: 'cancel', value: null },
        { label: 'Zaloguj się', style: 'primary', value: 'ok' },
      ],
    });
    if (!ok || !(await confirmPendingSync())) return false;
    const r = await loginWithEmailCode(services, email, code);
    if (r.error) throw r.error;
    setFlow(null);
    const u = useUserStore.getState();
    if (r.sameAccount) {
      ui.toast('Już jesteś zalogowany na to konto', 'verified_user');
      return true;
    }
    if (!r.hydrated) ui.toast('Zalogowano – stan konta pobierze się po połączeniu z serwerem', 'cloud_off');
    else ui.toast(`Zalogowano jako ${u.user.name}`, 'login');
    // Konto bez onboardingu – układ sam przełączy na ekran powitalny; z onboardingiem – na start.
    if (u.onboarded) {
      if (router.canDismiss()) router.dismissAll();
      router.navigate('/');
    }
    return true;
  };

  const logout = async () => {
    const ok = await ui.choose({
      title: 'Wylogować się?',
      message: `Postępy zostają na koncie ${info?.email ?? ''} – zalogujesz się na nie kodem z e-maila. Na tym telefonie zaczniesz od nowa jako nowy gracz.`,
      icon: 'logout',
      actions: [
        { label: 'Anuluj', style: 'cancel', value: null },
        { label: 'Wyloguj', style: 'danger', value: 'ok' },
      ],
    });
    if (!ok || !(await confirmPendingSync())) return;
    setBusy(true);
    try {
      const r = await signOut(services);
      if (!r.ok) ui.toast('Nie udało się wylogować – spróbuj ponownie', 'error');
      else ui.toast('Wylogowano', 'logout');
    } finally {
      setBusy(false);
    }
  };

  if (info === undefined || busy) {
    return <ActivityIndicator color={colors.primary} style={{ paddingVertical: 24 }} />;
  }

  return (
    <>
      {info === null ? (
        <StatusCard
          icon="cloud_off"
          tone={{ bg: colors.canvas, fg: colors.muted }}
          title="Brak połączenia z kontem"
          text="Nie udało się sprawdzić konta. Gra działa dalej na telefonie – spróbuj ponownie, gdy będzie internet."
        >
          <Button3D title="Spróbuj ponownie" icon="refresh" size="md" onPress={load} />
        </StatusCard>
      ) : info.anonymous ? (
        <StatusCard
          icon="person_off"
          tone={{ bg: colors.warnBg, fg: colors.warnIcon }}
          title="Konto anonimowe"
          text="Twoje postępy są tylko na tym urządzeniu i na serwerze pod anonimowym kontem – zabezpiecz je e-mailem. Bez adresu po usunięciu aplikacji albo zmianie telefonu nie odzyskasz konta."
        >
          {flow?.kind !== 'link' ? (
            <Button3D title="Zabezpiecz konto e-mailem" icon="mail" size="md" onPress={() => setFlow({ kind: 'link' })} />
          ) : null}
        </StatusCard>
      ) : (
        <StatusCard
          icon="verified_user"
          tone={{ bg: colors.primaryTint, fg: colors.primaryText }}
          title="Konto zabezpieczone"
          text={`Zalogowano jako ${info.email}. Kodem z tego adresu zalogujesz się na innym telefonie – postępy są na serwerze.`}
        />
      )}

      {flow?.kind === 'link' ? (
        <Card radius={22} padding={16} gap={12}>
          <Txt f="b7" size={18}>
            Zabezpiecz konto e-mailem
          </Txt>
          <EmailCodeFlow
            purpose="link"
            initialEmail={info?.pendingEmail ?? ''}
            send={sendLinkCode}
            verify={linked}
            onCancel={() => setFlow(null)}
            onUseLogin={(email) => setFlow({ kind: 'login', email })}
          />
        </Card>
      ) : null}

      {flow?.kind === 'login' ? (
        <Card radius={22} padding={16} gap={12}>
          <Txt f="b7" size={18}>
            Zaloguj się na inne konto
          </Txt>
          <EmailCodeFlow
            key={flow.email ?? 'login'}
            purpose="login"
            initialEmail={flow.email}
            send={sendLoginCode}
            verify={login}
            onCancel={() => setFlow(null)}
          />
        </Card>
      ) : null}

      {info && !flow ? (
        <SettingsGroup
          title="Logowanie"
          footer={
            <Txt f="n6" size={12} color={colors.muted} style={{ paddingHorizontal: 4 }}>
              Logujemy się jednorazowym kodem z e-maila – bez haseł. Inni gracze nie widzą Twojego adresu.
            </Txt>
          }
        >
          <SettingsRow
            icon="switch_account"
            iconBg={colors.infoBg}
            iconColor={colors.infoText}
            label="Zaloguj się na inne konto"
            sub="Masz konto z e-mailem na innym telefonie? Wpisz kod z e-maila"
            onPress={() => setFlow({ kind: 'login' })}
          />
          {!info.anonymous ? <SettingsRow icon="logout" danger label="Wyloguj" sub="Na tym telefonie zaczniesz od nowa" onPress={() => void logout()} /> : null}
        </SettingsGroup>
      ) : null}

      {info ? (
        <View style={{ gap: 4, paddingHorizontal: 4, marginBottom: 4 }}>
          <Txt f="n7" size={12} color={colors.muted}>
            Identyfikator konta (podaj go, pisząc do nas w sprawie danych):
          </Txt>
          <Txt f="n6" size={12} color={colors.faint} selectable>
            {info.userId}
          </Txt>
        </View>
      ) : null}
    </>
  );
}

function StatusCard({
  icon,
  tone,
  title,
  text,
  children,
}: {
  icon: IconName;
  tone: { bg: string; fg: string };
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <Card radius={22} padding={16} gap={14}>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.bg }}>
          <Icon name={icon} filled size={28} color={tone.fg} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt f="b7" size={18} lh={1.25}>
            {title}
          </Txt>
          <Txt f="n6" size={13} color={colors.muted}>
            {text}
          </Txt>
        </View>
      </View>
      {children}
    </Card>
  );
}
