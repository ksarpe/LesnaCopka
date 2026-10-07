import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { gminaIndex } from '@/geo';
import { gminaShape } from '@/geo/voivodeships';
import { useAsync } from '@/hooks/useAsync';
import { mapColors } from '@/theme/tokens';

interface GminaSilhouetteProps {
  gminaId: string;
  /** Obszar rysowania w nagłówku (px od krawędzi rodzica). */
  top: number;
  bottom: number;
  side: number;
}

/**
 * Kontur gminy z PRG (offline) na paskowanym nagłówku – w stylu granicy z mapy okolicy
 * (przerywana linia), zamiast podpisu „zdjęcie lasu gminy”, dopóki nie ma prawdziwych zdjęć.
 */
export function GminaSilhouette({ gminaId, top, bottom, side }: GminaSilhouetteProps) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    const h = Math.round(e.nativeEvent.layout.height);
    if (!box || box.w !== w || box.h !== h) setBox({ w, h });
  };
  const shape = useAsync(
    async () => (box && box.w > 0 && box.h > 0 ? gminaShape(await gminaIndex(), gminaId, box.w, box.h) : null),
    [gminaId, box?.w, box?.h],
  );
  const g = shape.data?.gminy[0];
  return (
    <View
      pointerEvents="none"
      onLayout={onLayout}
      style={{ position: 'absolute', left: side, right: side, top, bottom, alignItems: 'center', justifyContent: 'center' }}
    >
      {g && shape.data ? (
        <Svg width={shape.data.width} height={shape.data.height}>
          <Path
            d={g.d}
            fillRule="evenodd"
            fill="rgba(255,255,255,0.42)"
            stroke={mapColors.boundary}
            strokeOpacity={0.6}
            strokeWidth={1.8}
            strokeDasharray="7 5"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}
