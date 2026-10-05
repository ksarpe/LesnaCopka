import { Pressable, View } from 'react-native';

import { colors, shadows } from '@/theme/tokens';
import { Txt } from './Txt';

interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

/** Segmented: tło #EAE3D4, radius 16, padding 4; aktywny segment biały z cieniem. */
export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.chip, borderRadius: 16, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              borderRadius: 12,
              padding: 8,
              backgroundColor: active ? colors.card : 'transparent',
              boxShadow: active ? shadows.card : undefined,
            }}
          >
            <Txt f="n8" size={14} color={active ? colors.ink : colors.muted} align="center">
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
