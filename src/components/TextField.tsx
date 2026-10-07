import { forwardRef, useState, type ReactNode } from 'react';
import { Platform, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { colors, fonts, shadows } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Komunikat walidacji pod polem (czerwona ramka). */
  error?: string | null;
  /** Podpowiedź pod polem, gdy nie ma błędu. */
  hint?: string;
  /** Stały przedrostek przed tekstem, np. „@” w nicku. */
  prefix?: string;
  /** Ikona na początku pola (np. lupa w wyszukiwarce). */
  icon?: IconName;
  /** Licznik znaków „37/120” po prawej pod polem. */
  counter?: { value: number; max: number };
  /** Element na końcu pola (np. przycisk czyszczenia). */
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Pole tekstowe w stylu aplikacji: biała karta r16, Nunito 16, zielona ramka przy fokusie, czerwona przy błędzie. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, prefix, icon, counter, right, style, multiline, onFocus, onBlur, onLayout, ...input },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const over = counter ? counter.value > counter.max : false;
  return (
    // onLayout dotyczy całego pola (z etykietą) – do przewijania formularza nad klawiaturę.
    <View style={[{ gap: 6 }, style]} onLayout={onLayout}>
      {label ? (
        <Txt f="n8" size={13} color={colors.muted} style={{ marginLeft: 4 }}>
          {label}
        </Txt>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          gap: 8,
          backgroundColor: colors.card,
          borderRadius: 16,
          borderWidth: 2,
          borderColor: error ? colors.danger : focused ? colors.primary : colors.card,
          paddingHorizontal: 14,
          boxShadow: shadows.card,
        }}
      >
        {icon ? <Icon name={icon} size={22} color={colors.faint} style={multiline ? { marginTop: 12 } : undefined} /> : null}
        {prefix ? (
          <Txt f="n8" size={16} color={colors.faint} style={{ marginRight: -6 }}>
            {prefix}
          </Txt>
        ) : null}
        <TextInput
          ref={ref}
          {...input}
          multiline={multiline}
          allowFontScaling={false}
          placeholderTextColor={colors.disabled}
          selectionColor={colors.primary}
          cursorColor={colors.primaryShadow}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[
            {
              flex: 1,
              minWidth: 0,
              fontFamily: fonts.nunito700,
              fontSize: 16,
              color: colors.ink,
              paddingVertical: 12,
              paddingHorizontal: 0,
            },
            multiline && { minHeight: 92, lineHeight: 22, textAlignVertical: 'top', paddingTop: 12 },
            // Web: bez domyślnej niebieskiej obwódki przeglądarki (fokus pokazuje ramka karty).
            Platform.OS === 'web' && { outlineWidth: 0 },
          ]}
        />
        {right}
      </View>
      {error || hint || counter ? (
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 4 }}>
          <Txt f={error ? 'n7' : 'n6'} size={12} color={error ? colors.danger : colors.muted} style={{ flex: 1 }}>
            {error ?? hint ?? ''}
          </Txt>
          {counter ? (
            <Txt f="n7" size={12} color={over ? colors.danger : colors.faint}>
              {counter.value}/{counter.max}
            </Txt>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});
