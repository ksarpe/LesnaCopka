import { View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, medalDefault, medals, shadows } from '@/theme/tokens';
import type { PlayerRankRow as Row } from '@/types';
import { fmtInt, plural } from '@/utils/format';
import { levelTitle } from '@/utils/xp';
import { Avatar, authorRingColor } from './Avatar';
import { Pill } from './Pill';
import { Txt } from './Txt';

/**
 * Wiersz rankingu grzybiarzy (styl wierszy rankingu gmin): medal z miejscem (podium – złoto / srebro / brąz), avatar,
 * nick z poziomem i punkty. Wiersz gracza – zielona obwódka i „Ty”.
 */
export function PlayerRankRow({ row, style }: { row: Row; style?: StyleProp<ViewStyle> }) {
  const u = row.user;
  return (
    <View
      accessible
      accessibilityLabel={`${row.rank}. miejsce: ${row.isMe ? 'Ty' : u.name}, ${fmtInt(row.xp)} ${plural(row.xp, 'punkt', 'punkty', 'punktów')}`}
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: 18,
          paddingVertical: 10,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          boxShadow: shadows.card,
          borderWidth: 2.5,
          borderColor: row.isMe ? colors.primary : 'transparent',
        },
        style,
      ]}
    >
      <View
        style={{
          minWidth: 34,
          height: 34,
          paddingHorizontal: 4,
          borderRadius: 17,
          backgroundColor: medals[row.rank - 1] ?? medalDefault,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Txt f="b7" size={row.rank > 99 ? 13 : 16}>
          {row.rank}
        </Txt>
      </View>
      <Avatar size={38} ringWidth={2.5} ringColor={row.isMe ? colors.primary : authorRingColor(u)} avatar={u.avatar} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt f="n8" size={15} numberOfLines={1} style={{ flexShrink: 1 }}>
            {u.name}
          </Txt>
          {row.isMe ? <Pill label="Ty" size={11} padV={2} padH={7} /> : null}
        </View>
        <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
          Lv {u.level} · {levelTitle(u.level)}
        </Txt>
      </View>
      <Txt f="b7" size={17}>
        {fmtInt(row.xp)}
        <Txt f="n7" size={12} color={colors.muted}>
          {' '}
          pkt
        </Txt>
      </Txt>
    </View>
  );
}
