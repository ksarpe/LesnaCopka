import { router, type Href } from 'expo-router';
import { Text, View } from 'react-native';

import { LEGAL_DOCS, LEGAL_DRAFT_NOTICE, fmtLegalDate, splitBold, type LegalBlock, type LegalDoc, type LegalDocId } from '@/data/legal';
import { colors, fonts } from '@/theme/tokens';
import { Card } from './Card';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';
import { Screen } from './Screen';
import { SettingsGroup, SettingsRow } from './Settings';
import { Txt } from './Txt';

/** Trasy ekranów z dokumentami (Ustawienia → Informacje prawne). */
export const LEGAL_HREF: Record<LegalDocId, Href> = {
  regulamin: '/ustawienia/regulamin' as Href,
  prywatnosc: '/ustawienia/prywatnosc' as Href,
};

export const LEGAL_ICON: Record<LegalDocId, IconName> = {
  regulamin: 'menu_book',
  prywatnosc: 'privacy_tip',
};

const BODY = { f: 'n6', size: 15, lh: 1.5, color: colors.bodyDark } as const;

/** Tekst z `**pogrubieniami**` (splitBold) – pogrubienie to tylko krój, bez zmiany wysokości linii. */
function Rich({ text, color = BODY.color, size = BODY.size }: { text: string; color?: string; size?: number }) {
  return (
    <Txt f={BODY.f} size={size} lh={BODY.lh} color={color}>
      {splitBold(text).map((r, i) =>
        r.bold ? (
          <Text key={i} style={{ fontFamily: fonts.nunito800 }}>
            {r.text}
          </Text>
        ) : (
          r.text
        ),
      )}
    </Txt>
  );
}

function Bullets({ items, color = BODY.color, dot = colors.primary }: { items: string[]; color?: string; dot?: string }) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot, marginTop: 9 }} />
          <View style={{ flex: 1 }}>
            <Rich text={item} color={color} />
          </View>
        </View>
      ))}
    </View>
  );
}

const BOX_TONE = {
  warn: { bg: colors.warnBg, border: colors.warnBorder, icon: 'warning', iconColor: colors.warnIcon, title: colors.warnTitle, text: colors.warnText },
  info: { bg: colors.primaryTint, border: colors.primaryTint, icon: 'shield', iconColor: colors.primaryText, title: colors.primaryTintText, text: colors.primaryTintBody },
} as const;

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === 'p') return <Rich text={block.text} />;
  if (block.kind === 'list') return <Bullets items={block.items} />;
  const t = BOX_TONE[block.tone];
  return (
    <View style={{ backgroundColor: t.bg, borderWidth: 2, borderColor: t.border, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 12 }}>
      <Icon name={t.icon} filled size={26} color={t.iconColor} />
      <View style={{ flex: 1, gap: 6 }}>
        <Txt f="n8" size={15} color={t.title}>
          {block.title}
        </Txt>
        {block.text ? <Rich text={block.text} color={t.text} size={14} /> : null}
        {block.items ? <Bullets items={block.items} color={t.text} dot={t.iconColor} /> : null}
      </View>
    </View>
  );
}

/** Ekran dokumentu prawnego (regulamin / polityka prywatności) – treść z src/data/legal.ts. */
export function LegalDocView({ doc }: { doc: LegalDoc }) {
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/ustawienia' as Href));
  const others = LEGAL_DOCS.filter((d) => d.id !== doc.id);
  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            {doc.title}
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <View style={{ backgroundColor: colors.dangerBg, borderWidth: 2, borderColor: colors.dangerBorder, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 12 }}>
          <Icon name="edit_note" size={26} color={colors.danger} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt f="n8" size={14} color={colors.dangerTitle}>
              {LEGAL_DRAFT_NOTICE}
            </Txt>
            <Txt f="n6" size={13} color={colors.dangerText}>
              To wersja robocza. Miejsca w nawiasach kwadratowych zostaną uzupełnione przed wydaniem aplikacji.
            </Txt>
          </View>
        </View>

        <View style={{ gap: 4 }}>
          <Txt f="b7" size={26} lh={1.25} accessibilityRole="header">
            {doc.fullTitle}
          </Txt>
          <Txt f="n7" size={13} color={colors.muted}>
            Wersja robocza z {fmtLegalDate(doc.updated)}
          </Txt>
        </View>

        {doc.intro.map((b, i) => (
          <Block key={i} block={b} />
        ))}

        {doc.sections.map((s) => (
          <Card key={s.title} radius={22} padding={16} gap={12}>
            <Txt f="b7" size={19} lh={1.3} accessibilityRole="header">
              {s.title}
            </Txt>
            {s.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </Card>
        ))}

        <SettingsGroup title="Zobacz też">
          {others.map((d) => (
            <SettingsRow
              key={d.id}
              icon={LEGAL_ICON[d.id]}
              iconBg={colors.chip}
              iconColor={colors.tagNeutralText}
              label={d.title}
              onPress={() => router.replace(LEGAL_HREF[d.id])}
            />
          ))}
        </SettingsGroup>
      </View>
    </Screen>
  );
}
