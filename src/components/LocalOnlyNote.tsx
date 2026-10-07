import { View } from 'react-native';

import { colors } from '@/theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

/**
 * Stopka list historii (wyprawy, znaleziska): licznik profilu jest większy niż to, co jest w telefonie
 * (gracz demo, starsze wyprawy spoza okna serwera, nowe urządzenie). Styl jak przypis na karcie gatunku.
 */
export function LocalOnlyNote({ title, text }: { title: string; text?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4, paddingTop: 16 }}>
      <Icon name="history" size={16} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <Txt f="n7" size={12} color={colors.muted}>
          {title}
        </Txt>
        {text ? (
          <Txt f="n6" size={12} color={colors.faint}>
            {text}
          </Txt>
        ) : null}
      </View>
    </View>
  );
}
