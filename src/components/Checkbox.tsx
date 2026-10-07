import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { colors, shadows } from '@/theme/tokens';
import { hapticLight } from './Button3D';
import { Icon } from './Icon';
import { Txt } from './Txt';

interface CheckRowProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  /** Drobny tekst pod etykietą (albo element, np. linki). */
  sub?: ReactNode;
  accessibilityLabel?: string;
}

/** Wymagane potwierdzenie (onboarding): biała karta, zielony kwadrat z ✓ – cała karta jest polem wyboru. */
export function CheckRow({ checked, onChange, label, sub, accessibilityLabel }: CheckRowProps) {
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        onChange(!checked);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        backgroundColor: pressed ? colors.outlineHover : colors.card,
        borderRadius: 18,
        borderWidth: 2,
        borderColor: checked ? colors.primary : colors.card,
        paddingVertical: 12,
        paddingHorizontal: 14,
        boxShadow: shadows.card,
      })}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: 8,
          borderWidth: checked ? 0 : 2.5,
          borderColor: colors.outline,
          backgroundColor: checked ? colors.primary : colors.bg,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {checked ? <Icon name="check" size={20} color={colors.primaryInk} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt f="n8" size={15} lh={1.35}>
          {label}
        </Txt>
        {typeof sub === 'string' ? (
          <Txt f="n6" size={12} color={colors.muted}>
            {sub}
          </Txt>
        ) : (
          sub
        )}
      </View>
    </Pressable>
  );
}
