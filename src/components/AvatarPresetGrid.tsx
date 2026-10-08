import { Pressable, View } from 'react-native';

import { AVATAR_PRESETS } from '@/data/avatars';
import { colors, shadows } from '@/theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

/** Siatka „motywów grzybowych” (4 w rzędzie): edycja profilu. */
export function AvatarPresetGrid({
  selectedId,
  onSelect,
  size = 54,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  size?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }}>
      {AVATAR_PRESETS.map((p) => {
        const selected = selectedId === p.id;
        return (
          <Pressable
            key={p.id}
            onPress={() => onSelect(p.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Motyw ${p.label}`}
            style={({ pressed }) => ({ width: '25%', alignItems: 'center', gap: 6, opacity: pressed ? 0.8 : 1 })}
          >
            <View
              style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: p.bg,
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: selected ? shadows.selectedTile : undefined,
              }}
            >
              <Icon name={p.icon} filled size={Math.round(size * 0.52)} color={p.fg} />
            </View>
            <Txt f={selected ? 'n8' : 'n7'} size={11} color={selected ? colors.ink : colors.muted} numberOfLines={1}>
              {p.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
