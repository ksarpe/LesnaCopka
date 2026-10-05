import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Placeholder } from './Placeholder';

interface ThumbProps {
  /** Rozmiar zewnętrzny (w makiecie content-box + ramka 3 px). */
  size: number;
  radius: number;
  borderColor: string;
  borderWidth?: number;
  stripe?: number;
  style?: StyleProp<ViewStyle>;
}

/** Miniatura znaleziska: paski + kolorowa ramka w kolorze rzadkości. */
export function Thumb({ size, radius, borderColor, borderWidth = 3, stripe = 5, style }: ThumbProps) {
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: radius, borderWidth, borderColor, overflow: 'hidden' },
        style,
      ]}
    >
      <Placeholder variant="sand" stripe={stripe} style={{ flex: 1 }} />
    </View>
  );
}
