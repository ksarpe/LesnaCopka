import { router } from 'expo-router';
import { View } from 'react-native';

import { useUnreadCount } from '@/store/useNotificationStore';
import { colors } from '@/theme/tokens';
import { IconButton } from './IconButton';
import { Txt } from './Txt';

/** Dzwonek centrum powiadomień (nagłówek Feedu): IconButton 44 px + licznik nieprzeczytanych. */
export function NotificationBell() {
  const unread = useUnreadCount();
  return (
    <View>
      <IconButton
        icon="notifications"
        filled={unread > 0}
        accessibilityLabel={unread ? `Powiadomienia, nieprzeczytane: ${unread}` : 'Powiadomienia'}
        onPress={() => router.push('/powiadomienia')}
      />
      {unread > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            minWidth: 20,
            height: 20,
            borderRadius: 10,
            paddingHorizontal: 5,
            backgroundColor: colors.danger,
            borderWidth: 2,
            borderColor: colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt f="n8" size={11} lh={13} color={colors.white}>
            {unread > 9 ? '9+' : unread}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}
