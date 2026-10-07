import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { addSampleNotifications, deliverDue, sendTestNotification } from '@/store/notify';
import { useNotificationStore, useUnreadCount } from '@/store/useNotificationStore';
import { ui } from '@/store/useUiStore';
import { colors } from '@/theme/tokens';

const PERMISSION_LABEL = {
  granted: 'zgoda',
  denied: 'odmowa',
  undetermined: 'nie pytano',
  unsupported: 'niedostępne (web)',
} as const;

/** Sekcja „Powiadomienia” panelu /dev: przykładowe wpisy, test, doręczenie zaplanowanych, czyszczenie. */
export function NotificationsPanel() {
  const inbox = useNotificationStore((s) => s.inbox.length);
  const pending = useNotificationStore((s) => s.pending.length);
  const permission = useNotificationStore((s) => s.permission);
  const unread = useUnreadCount();

  return (
    <Card radius={22} padding={16} gap={10}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="notifications" filled size={20} color={colors.primaryText} />
        <Txt f="b7" size={18}>
          Powiadomienia
        </Txt>
      </View>
      <Txt f="n6" size={12} color={colors.muted}>
        W centrum: {inbox} ({unread} nowe) · zaplanowane: {pending} · zgoda systemowa: {PERMISSION_LABEL[permission]}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <Chip
          onPress={() => {
            addSampleNotifications();
            ui.toast('Dodano przykładowe powiadomienia', 'notifications_active');
          }}
        >
          Dodaj przykładowe
        </Chip>
        <Chip onPress={() => void sendTestNotification(5)}>Wyślij testowe (5 s)</Chip>
        <Chip
          onPress={() => {
            const n = deliverDue({ all: true, toast: false }).length;
            ui.toast(n ? `Doręczono zaplanowane: ${n}` : 'Brak zaplanowanych powiadomień', 'done_all');
          }}
        >
          Doręcz zaplanowane teraz
        </Chip>
        <Chip
          onPress={() => {
            useNotificationStore.getState().clearInbox();
            ui.toast('Centrum powiadomień wyczyszczone', 'delete');
          }}
        >
          Wyczyść centrum
        </Chip>
        <Chip onPress={() => router.push('/powiadomienia')}>Otwórz centrum</Chip>
      </View>
    </Card>
  );
}

function Chip({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.canvas,
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 12,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Txt f="n8" size={13}>
        {children}
      </Txt>
    </Pressable>
  );
}
