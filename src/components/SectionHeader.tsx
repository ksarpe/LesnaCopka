import { Pressable, View } from 'react-native';

import { colors } from '@/theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

/** Nagłówek sekcji profilu: tytuł + licznik „23 / 120” po prawej (jak „Atlas gatunków” w makiecie). */
export function SectionHeader({ title, count }: { title: string; count?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
      <Txt f="b7" size={18}>
        {title}
      </Txt>
      {count ? (
        <Txt f="n8" size={13} color={colors.primaryText}>
          {count}
        </Txt>
      ) : null}
    </View>
  );
}

/** „Zobacz wszystko ›” – obrysowany przycisk na całą szerokość pod podglądem sekcji. */
export function SeeAllButton({ label = 'Zobacz wszystko', onPress }: { label?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        borderWidth: 2.5,
        borderColor: colors.outline,
        borderRadius: 18,
        paddingVertical: 10,
        backgroundColor: pressed ? colors.outlineHover : 'transparent',
      })}
    >
      <Txt f="b7" size={15} color={colors.outlineText}>
        {label}
      </Txt>
      <Icon name="chevron_right" size={20} color={colors.outlineText} />
    </Pressable>
  );
}
