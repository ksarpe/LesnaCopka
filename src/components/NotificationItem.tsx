import { Pressable, View } from 'react-native';

import type { InboxItem } from '@/store/useNotificationStore';
import { colors } from '@/theme/tokens';
import { fmtAgo } from '@/utils/format';
import type { NotifKind } from '@/utils/notifications';
import { Icon } from './Icon';
import { Txt } from './Txt';

/** Kolory kafla ikony per kategoria (te same co w wierszach ustawień powiadomień). */
export const NOTIF_TONE: Record<NotifKind, { bg: string; fg: string }> = {
  streak: { bg: colors.streakBg, fg: colors.streakText },
  visible: { bg: colors.infoBg, fg: colors.infoText },
  social: { bg: colors.dangerBg, fg: colors.danger },
  gminy: { bg: colors.forest, fg: colors.xpOnDark },
  weekly: { bg: colors.badgeCard, fg: colors.legendText },
  longTrip: { bg: colors.questHikeBg, fg: colors.questHikeIcon },
  system: { bg: colors.primaryTint, fg: colors.primaryText },
};

/** Wiersz centrum powiadomień: kafel ikony, tytuł, treść, czas i kropka „nieprzeczytane”. */
export function NotificationItem({
  item,
  now,
  onPress,
  onLongPress,
}: {
  item: InboxItem;
  now: number;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const tone = NOTIF_TONE[item.kind] ?? NOTIF_TONE.system;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.read ? '' : 'Nieprzeczytane: '}${item.title}. ${item.body}`}
    >
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 12,
            paddingVertical: 13,
            paddingHorizontal: 14,
            backgroundColor: pressed ? colors.outlineHover : 'transparent',
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: tone.bg,
              opacity: item.read ? 0.75 : 1,
            }}
          >
            <Icon name={item.icon} filled size={22} color={tone.fg} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt f={item.read ? 'n7' : 'n8'} size={15} lh={1.3} color={item.read ? colors.bodyDark : colors.ink}>
              {item.title}
            </Txt>
            <Txt f="n6" size={13} lh={1.35} color={colors.muted} numberOfLines={3}>
              {item.body}
            </Txt>
            <Txt f="n7" size={12} color={colors.faint} style={{ marginTop: 2 }}>
              {fmtAgo(item.createdAt, now)}
            </Txt>
          </View>
          {item.read ? null : (
            <View
              accessibilityElementsHidden
              style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 }}
            />
          )}
        </View>
      )}
    </Pressable>
  );
}
