import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useFindPhotoSource } from '@/hooks/useFindPhotoSource';
import { Placeholder } from './Placeholder';

interface ThumbProps {
  /** Rozmiar zewnętrzny (w makiecie content-box + ramka 3 px). */
  size: number;
  radius: number;
  borderColor: string;
  borderWidth?: number;
  /** Zdjęcie znaleziska (`Find.photoUri`) – bez niego (albo gdy nie da się go wczytać) kafel ze znakiem grzyba. */
  uri?: string;
  style?: StyleProp<ViewStyle>;
}

/** Miniatura znaleziska: zdjęcie albo kafel w odcieniu ramki (kolor rzadkości) ze znakiem grzyba. */
export function Thumb({ size, radius, borderColor, borderWidth = 3, uri, style }: ThumbProps) {
  const source = useFindPhotoSource(uri);
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: radius, borderWidth, borderColor, overflow: 'hidden' },
        style,
      ]}
    >
      <Placeholder
        source={source}
        tile={{ tint: borderColor, glyph: 'mushroom', glyphSize: Math.round((size - 2 * borderWidth) * 0.5) }}
        style={{ flex: 1 }}
      />
    </View>
  );
}
