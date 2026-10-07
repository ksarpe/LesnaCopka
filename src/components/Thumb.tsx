import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useFindPhotoSource } from '@/hooks/useFindPhotoSource';
import { Placeholder } from './Placeholder';

interface ThumbProps {
  /** Rozmiar zewnętrzny (w makiecie content-box + ramka 3 px). */
  size: number;
  radius: number;
  borderColor: string;
  borderWidth?: number;
  stripe?: number;
  /** Zdjęcie znaleziska (`Find.photoUri`) – bez niego (albo gdy nie da się go wczytać) paski z makiety. */
  uri?: string;
  style?: StyleProp<ViewStyle>;
}

/** Miniatura znaleziska: zdjęcie albo paski + kolorowa ramka w kolorze rzadkości. */
export function Thumb({ size, radius, borderColor, borderWidth = 3, stripe = 5, uri, style }: ThumbProps) {
  const source = useFindPhotoSource(uri);
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: radius, borderWidth, borderColor, overflow: 'hidden' },
        style,
      ]}
    >
      <Placeholder variant="sand" stripe={stripe} source={source} style={{ flex: 1 }} />
    </View>
  );
}
