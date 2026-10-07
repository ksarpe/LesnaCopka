import { router } from 'expo-router';
import { Fragment, useMemo } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { NotificationItem } from '@/components/NotificationItem';
import { StateCard } from '@/components/OfflineCard';
import { Screen } from '@/components/Screen';
import { Txt } from '@/components/Txt';
import { useNow } from '@/hooks/useNow';
import { openNotification } from '@/store/notify';
import { useNotificationStore, type InboxItem } from '@/store/useNotificationStore';
import { ui } from '@/store/useUiStore';
import { colors, shadows } from '@/theme/tokens';
import { plural } from '@/utils/format';
import { groupByDay } from '@/utils/notifications';

/** Centrum powiadomień (dzwonek w Feedzie): „Dzisiaj” / „Wcześniej”, nieprzeczytane, przejście do celu. */
export default function NotificationsInbox() {
  const inbox = useNotificationStore((s) => s.inbox);
  const permission = useNotificationStore((s) => s.permission);
  const now = useNow(30000);
  const groups = useMemo(() => groupByDay(inbox, new Date(now)), [inbox, now]);
  const unread = inbox.filter((i) => !i.read).length;
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/feed'));
  const settings = () => router.push('/ustawienia/powiadomienia');

  const remove = (item: InboxItem) =>
    ui.confirm({
      title: 'Usunąć powiadomienie?',
      message: item.title,
      icon: 'delete',
      confirmLabel: 'Usuń',
      danger: true,
      onConfirm: () => useNotificationStore.getState().remove(item.id),
    });

  const clearAll = () =>
    ui.confirm({
      title: 'Wyczyścić centrum?',
      message: 'Usuniemy wszystkie powiadomienia z listy. Ustawienia zostaną bez zmian.',
      icon: 'delete_forever',
      confirmLabel: 'Wyczyść',
      danger: true,
      onConfirm: () => useNotificationStore.getState().clearInbox(),
    });

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Powiadomienia
          </Txt>
          <IconButton icon="settings" onPress={settings} accessibilityLabel="Ustawienia powiadomień" />
        </View>

        {Platform.OS !== 'web' && (permission === 'undetermined' || permission === 'denied') && inbox.length > 0 ? (
          <Pressable
            onPress={settings}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: colors.warnBg,
              borderWidth: 2,
              borderColor: colors.warnBorder,
              borderRadius: 18,
              paddingVertical: 10,
              paddingHorizontal: 12,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            <Icon name="notifications_off" filled size={22} color={colors.warnIcon} />
            <Txt f="n7" size={13} color={colors.warnText} style={{ flex: 1 }}>
              Powiadomienia systemowe są wyłączone – nowości zobaczysz tylko tutaj.
            </Txt>
            <Txt f="n8" size={13} color={colors.warnTitle}>
              Włącz
            </Txt>
          </Pressable>
        ) : null}

        {inbox.length === 0 ? (
          <StateCard
            icon="notifications_none"
            title="Brak powiadomień"
            text="Tu zobaczysz reakcje znajomych, wyzwania obserwowanych gmin i przypomnienia o serii."
            action="Ustawienia powiadomień"
            onAction={settings}
          />
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Txt f="n7" size={14} color={colors.muted}>
                {unread ? `${unread} ${plural(unread, 'nowe', 'nowe', 'nowych')}` : 'Wszystko przeczytane'}
              </Txt>
              {unread ? (
                <Pressable
                  onPress={() => useNotificationStore.getState().markAllRead()}
                  hitSlop={8}
                  accessibilityRole="button"
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, opacity: pressed ? 0.6 : 1 })}
                >
                  <Icon name="done_all" size={18} color={colors.primaryText} />
                  <Txt f="n8" size={13} color={colors.primaryText} numberOfLines={1} style={{ flexShrink: 1 }}>
                    Oznacz wszystkie jako przeczytane
                  </Txt>
                </Pressable>
              ) : null}
            </View>

            <Group title="Dzisiaj" items={groups.today} now={now} onLongPress={remove} />
            <Group title="Wcześniej" items={groups.earlier} now={now} onLongPress={remove} />

            <Pressable
              onPress={clearAll}
              accessibilityRole="button"
              style={({ pressed }) => ({
                alignSelf: 'center',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 8,
                paddingHorizontal: 14,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Icon name="delete" size={18} color={colors.faint} />
              <Txt f="n8" size={13} color={colors.faint}>
                Wyczyść centrum powiadomień
              </Txt>
            </Pressable>
          </>
        )}
      </View>
    </Screen>
  );
}

function Group({
  title,
  items,
  now,
  onLongPress,
}: {
  title: string;
  items: InboxItem[];
  now: number;
  onLongPress: (item: InboxItem) => void;
}) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Txt f="b7" size={18}>
        {title}
      </Txt>
      <View style={{ backgroundColor: colors.card, borderRadius: 22, boxShadow: shadows.card, overflow: 'hidden' }}>
        {items.map((item, i) => (
          <Fragment key={item.id}>
            {i > 0 ? <View style={{ height: 1.5, backgroundColor: colors.track, marginLeft: 66 }} /> : null}
            <NotificationItem item={item} now={now} onPress={() => openNotification(item)} onLongPress={() => onLongPress(item)} />
          </Fragment>
        ))}
      </View>
    </View>
  );
}
