import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { colors, shadows } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Txt } from './Txt';

/** Grupa ustawień: tytuł sekcji (jak „Odznaki” w profilu) + biała karta z wierszami rozdzielonymi linią. */
export function SettingsGroup({ title, children, footer }: { title?: string; children: ReactNode; footer?: ReactNode }) {
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: 10 }}>
      {title ? (
        <Txt f="b7" size={18}>
          {title}
        </Txt>
      ) : null}
      <View style={{ backgroundColor: colors.card, borderRadius: 22, boxShadow: shadows.card, overflow: 'hidden' }}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={{ height: 1.5, backgroundColor: colors.track, marginLeft: 66 }} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer}
    </View>
  );
}

interface SettingsRowProps {
  icon: IconName;
  /** Kafel ikony – domyślnie zielony tint. */
  iconBg?: string;
  iconColor?: string;
  label: string;
  sub?: string;
  /** Bieżąca wartość po prawej (np. nazwa gminy, wersja). */
  value?: string;
  onPress?: () => void;
  /** Własny element po prawej (np. Toggle) – zamiast wartości i strzałki. */
  right?: ReactNode;
  danger?: boolean;
  accessibilityLabel?: string;
}

/** Wiersz ustawień: kafel ikony 38 px, etykieta (+ podpis), wartość i „›” albo przełącznik. */
export function SettingsRow({ icon, iconBg, iconColor, label, sub, value, onPress, right, danger, accessibilityLabel }: SettingsRowProps) {
  const content = (pressed: boolean) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 12,
        paddingHorizontal: 14,
        minHeight: 62,
        backgroundColor: pressed ? colors.outlineHover : 'transparent',
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: iconBg ?? (danger ? colors.dangerBg : colors.primaryTint),
        }}
      >
        <Icon name={icon} filled size={22} color={iconColor ?? (danger ? colors.danger : colors.primaryText)} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Txt f="n8" size={15} color={danger ? colors.danger : colors.ink}>
          {label}
        </Txt>
        {sub ? (
          <Txt f="n6" size={12} color={colors.muted}>
            {sub}
          </Txt>
        ) : null}
      </View>
      {right ?? (
        <>
          {value ? (
            <Txt f="n7" size={13} color={colors.muted} numberOfLines={1} style={{ maxWidth: 150 }}>
              {value}
            </Txt>
          ) : null}
          {onPress ? <Icon name="chevron_right" size={22} color={colors.disabled} /> : null}
        </>
      )}
    </View>
  );
  if (!onPress) return content(false);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label}>
      {({ pressed }) => content(pressed)}
    </Pressable>
  );
}
