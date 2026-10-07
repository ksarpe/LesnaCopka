import { Pressable, View } from 'react-native';

import { colors } from '@/theme/tokens';
import { Txt } from './Txt';

interface ChoiceChipsProps<T extends string | number> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

/** Pigułki wyboru jak filtry atlasu (aktywna ciemna) – sezony w historii wypraw, sortowanie dziennika. */
export function ChoiceChips<T extends string | number>({ options, value, onChange }: ChoiceChipsProps<T>) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.value)}
            style={({ pressed }) => ({
              backgroundColor: active ? colors.ink : colors.card,
              borderRadius: 999,
              paddingVertical: 6,
              paddingHorizontal: 12,
              opacity: pressed && !active ? 0.8 : 1,
            })}
          >
            <Txt f="n8" size={13} color={active ? colors.bg : colors.ink}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
