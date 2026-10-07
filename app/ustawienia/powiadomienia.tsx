import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';

import { Button3D } from '@/components/Button3D';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { NOTIF_TONE } from '@/components/NotificationItem';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SettingsGroup, SettingsRow } from '@/components/Settings';
import { Screen } from '@/components/Screen';
import { Toggle } from '@/components/Toggle';
import { Txt } from '@/components/Txt';
import { enableNotifications, sendTestNotification } from '@/store/notify';
import { useNotificationStore, useUnreadCount, type NotifPermission } from '@/store/useNotificationStore';
import { colors } from '@/theme/tokens';
import { plural } from '@/utils/format';
import { fmtHour, NOTIF_CATEGORIES, REMINDER_HOURS } from '@/utils/notifications';

const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const APP_NAME = IN_EXPO_GO ? 'Expo Go' : (Constants.expoConfig?.name ?? 'Grzybobranie');

/** Ustawienia → Powiadomienia: zgoda systemowa, kategorie, godzina przypomnienia, test. */
export default function NotificationSettings() {
  const prefs = useNotificationStore((s) => s.prefs);
  const hour = useNotificationStore((s) => s.reminderHour);
  const permission = useNotificationStore((s) => s.permission);
  const unread = useUnreadCount();
  const set = useNotificationStore.getState();
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/ustawienia' as Href));
  const system = permission === 'granted';

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Powiadomienia
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <PermissionCard permission={permission} />

        <SettingsGroup title="Co mamy Ci przypominać">
          {NOTIF_CATEGORIES.flatMap((c) => {
            const row = (
              <SettingsRow
                key={c.id}
                icon={c.icon}
                iconBg={NOTIF_TONE[c.id].bg}
                iconColor={NOTIF_TONE[c.id].fg}
                label={c.label}
                sub={c.description}
                right={<Toggle value={prefs[c.id]} onChange={(v) => set.setPref(c.id, v)} accessibilityLabel={c.label} />}
              />
            );
            return c.id === 'streak' ? [row, <ReminderHour key="hour" hour={hour} enabled={prefs.streak} />] : [row];
          })}
        </SettingsGroup>

        <SettingsGroup
          title="Sprawdź"
          footer={
            <Txt f="n6" size={12} color={colors.muted} style={{ paddingHorizontal: 4 }}>
              Powiadomienia planujemy na telefonie – bez Twojej lokalizacji. Wyłączone kategorie nie trafiają też do centrum
              powiadomień w aplikacji.
            </Txt>
          }
        >
          <SettingsRow
            icon="send"
            label="Wyślij testowe powiadomienie"
            sub={system ? 'Przyjdzie za 3 s – możesz zminimalizować aplikację' : 'Pojawi się za 3 s w centrum powiadomień'}
            onPress={() => void sendTestNotification(3)}
          />
          <SettingsRow
            icon="inbox"
            iconBg={colors.chip}
            iconColor={colors.tagNeutralText}
            label="Centrum powiadomień"
            sub="Wszystko, co przyszło – także bez zgody systemowej"
            value={unread ? `${unread} ${plural(unread, 'nowe', 'nowe', 'nowych')}` : undefined}
            onPress={() => router.push('/powiadomienia')}
          />
        </SettingsGroup>
      </View>
    </Screen>
  );
}

/** Stan zgody systemowej: włączone / do włączenia / zablokowane w ustawieniach / web. */
function PermissionCard({ permission }: { permission: NotifPermission }) {
  if (permission === 'granted') {
    return (
      <StatusCard
        icon="notifications_active"
        tone={{ bg: colors.primaryTint, fg: colors.primaryText }}
        title="Powiadomienia włączone"
        text="Przypomnimy o serii i damy znać o reakcjach znajomych – także gdy aplikacja jest zamknięta."
      />
    );
  }
  if (permission === 'undetermined') {
    return (
      <StatusCard
        icon="notifications_off"
        tone={{ bg: colors.canvas, fg: colors.muted }}
        title="Powiadomienia wyłączone"
        text="Włącz je, żeby nie przegapić reakcji znajomych, wyzwań w gminach i przypomnień o serii."
      >
        <Button3D title="Włącz powiadomienia" icon="notifications_active" size="md" onPress={() => void enableNotifications()} />
      </StatusCard>
    );
  }
  if (permission === 'denied') {
    return (
      <View
        style={{
          backgroundColor: colors.warnBg,
          borderWidth: 2,
          borderColor: colors.warnBorder,
          borderRadius: 22,
          padding: 16,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <Icon name="notifications_paused" filled size={28} color={colors.warnIcon} />
          <View style={{ flex: 1, gap: 2 }}>
            <Txt f="b7" size={18} lh={1.25} color={colors.warnTitle}>
              Wyłączone w ustawieniach systemu
            </Txt>
            <Txt f="n6" size={13} color={colors.warnText}>
              Zmień to w Ustawieniach telefonu → {APP_NAME} → Powiadomienia. Do tego czasu nowości zobaczysz w centrum
              powiadomień w aplikacji.
            </Txt>
          </View>
        </View>
        <Pressable
          onPress={() => Linking.openSettings().catch(() => {})}
          accessibilityRole="button"
          style={({ pressed }) => ({
            alignSelf: 'flex-start',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderWidth: 2.5,
            borderColor: colors.warnBorder,
            borderRadius: 18,
            paddingVertical: 8,
            paddingHorizontal: 14,
            backgroundColor: pressed ? colors.white : 'transparent',
          })}
        >
          <Icon name="settings" size={18} color={colors.warnTitle} />
          <Txt f="b7" size={15} color={colors.warnTitle}>
            Otwórz ustawienia
          </Txt>
        </Pressable>
      </View>
    );
  }
  // unsupported
  return (
    <StatusCard
      icon="info"
      tone={{ bg: colors.infoBg, fg: colors.infoText }}
      title={Platform.OS === 'web' ? 'Powiadomienia w przeglądarce' : 'Powiadomienia systemowe niedostępne'}
      text={
        Platform.OS === 'web'
          ? 'Na webie powiadomienia systemowe są niedostępne – zobaczysz je w centrum powiadomień w aplikacji.'
          : 'Ta wersja aplikacji nie obsługuje powiadomień systemowych – zobaczysz je w centrum powiadomień w aplikacji.'
      }
    />
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
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tone.bg,
          }}
        >
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

/** Godzina przypomnienia o serii: szybki wybór pełnej godziny. */
function ReminderHour({ hour, enabled }: { hour: number; enabled: boolean }) {
  const setHour = useNotificationStore((s) => s.setReminderHour);
  const options = REMINDER_HOURS.map((h) => ({ value: String(h), label: fmtHour(h) }));
  return (
    <View
      pointerEvents={enabled ? 'auto' : 'none'}
      style={{ paddingVertical: 12, paddingHorizontal: 14, gap: 12, opacity: enabled ? 1 : 0.45 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.chip,
          }}
        >
          <Icon name="alarm" filled size={22} color={colors.tagNeutralText} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Txt f="n8" size={15}>
            Godzina przypomnienia
          </Txt>
          <Txt f="n6" size={12} color={colors.muted}>
            Tylko w dni bez wyprawy i skanu
          </Txt>
        </View>
        <Txt f="b7" size={20} color={colors.primaryText}>
          {fmtHour(hour)}
        </Txt>
      </View>
      <SegmentedControl options={options} value={String(hour)} onChange={(v) => setHour(Number(v))} />
    </View>
  );
}
