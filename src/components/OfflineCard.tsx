import { Pressable, View } from 'react-native';

import { colors, shadows } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

/** Karta stanu pustego / błędu (brak sieci, pusty feed, pusty atlas). */
export function StateCard({
  icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: IconName;
  title: string;
  text?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 26,
        padding: 22,
        alignItems: 'center',
        gap: 10,
        boxShadow: shadows.card,
      }}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.canvas,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={32} color={colors.muted} />
      </View>
      <Txt f="b7" size={20} align="center" lh={1.2}>
        {title}
      </Txt>
      {text ? (
        <Txt f="n6" size={14} color={colors.muted} align="center">
          {text}
        </Txt>
      ) : null}
      {action ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => ({
            marginTop: 4,
            borderWidth: 2.5,
            borderColor: colors.outline,
            borderRadius: 18,
            paddingVertical: 9,
            paddingHorizontal: 18,
            backgroundColor: pressed ? colors.outlineHover : 'transparent',
          })}
        >
          <Txt f="b7" size={16} color={colors.outlineText}>
            {action}
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

export function OfflineCard({ onRetry }: { onRetry: () => void }) {
  return (
    <StateCard
      icon="wifi_off"
      title="Brak połączenia"
      text="Nie możemy pobrać danych. Twoje wyprawy i skany zapisują się lokalnie."
      action="Spróbuj ponownie"
      onAction={onRetry}
    />
  );
}
