import { memo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { useFindPhotoSource } from '@/hooks/useFindPhotoSource';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useTripStore } from '@/store/useTripStore';
import { colors, medalDefault, medals, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { ContestEntry, ContestKind } from '@/types';
import { entryPhotoUri, fmtCm, fmtContestScore, fmtPct } from '@/utils/contests';
import { gminaTitle } from '@/utils/format';
import { Icon } from './Icon';
import { Placeholder } from './Placeholder';
import { Thumb } from './Thumb';
import { Txt } from './Txt';

interface ContestEntryRowProps {
  entry: ContestEntry;
  kind: ContestKind;
  /** Gmina okazu w podpisie (zasięgi publiczne; znajomi widzą tylko liczby i gatunek). */
  showGmina?: boolean;
  /** Tap w nick → mini profil (cudze okazy). */
  onAuthor?: (entry: ContestEntry) => void;
  /** „⋯” → zgłoszenie okazu (cudze okazy). */
  onMore?: (entry: ContestEntry) => void;
}

/** Zdjęcie okazu: własne – z telefonu, cudze – z serwera (podpisany adres) albo kafel ze znakiem grzyba. */
function useEntryPhoto(entry: ContestEntry) {
  const local = useTripStore((s) => (entry.isMine ? s.finds[entry.findId]?.photoUri : undefined));
  return entryPhotoUri(entry, local);
}

/**
 * Wiersz tablicy walki (styl wierszy rankingu gmin): medal z miejscem (podium – złoto / srebro / brąz; bez miejsca –
 * „–”), miniatura zdjęcia (tap – powiększenie), nick, gatunek i gmina, wynik. Własny okaz – zielona obwódka.
 */
export const ContestEntryRow = memo(function ContestEntryRow({
  entry: e,
  kind,
  showGmina,
  onAuthor,
  onMore,
}: ContestEntryRowProps) {
  const sp = useCatalogStore((s) => s.speciesById[e.speciesId]);
  const gmina = useCatalogStore((s) => (showGmina && e.gminaId ? s.gminaById[e.gminaId] : undefined));
  const uri = useEntryPhoto(e);
  const [zoom, setZoom] = useState(false);
  const rarity = rarityTokens[sp?.rarity ?? 'pospolity'];
  const sub = [sp?.name ?? 'Nieznany gatunek', gmina ? gminaTitle(gmina) : null].filter(Boolean).join(' · ');
  const secondary = kind === 'species' ? fmtPct(e.relativePct) : fmtCm(e.capCm);
  const name = e.isMine ? 'Ty' : e.author.name;
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 18,
        paddingVertical: 10,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        boxShadow: shadows.card,
        borderWidth: 2.5,
        borderColor: e.isMine ? colors.primary : 'transparent',
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: e.rank != null ? (medals[e.rank - 1] ?? medalDefault) : medalDefault,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Txt f="b7" size={e.rank != null && e.rank > 99 ? 12 : 15}>
          {e.rank ?? '–'}
        </Txt>
      </View>
      <Pressable
        onPress={() => setZoom(true)}
        hitSlop={4}
        accessibilityRole="imagebutton"
        accessibilityLabel={`Zdjęcie okazu: ${sp?.name ?? ''}`}
      >
        <Thumb size={46} radius={14} borderColor={rarity.color} borderWidth={2.5} uri={uri} />
      </Pressable>
      <View style={{ flex: 1, gap: 1 }}>
        {onAuthor && !e.isMine ? (
          <Pressable
            onPress={() => onAuthor(e)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={`Profil: ${e.author.name}`}
            style={{ alignSelf: 'flex-start' }}
          >
            <Txt f="n8" size={15} numberOfLines={1}>
              {name}
            </Txt>
          </Pressable>
        ) : (
          <Txt f="n8" size={15} numberOfLines={1}>
            {name}
          </Txt>
        )}
        <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
          {sub}
        </Txt>
        {e.status === 'review' ? (
          <Txt f="n8" size={11} color={colors.warnIcon}>
            W weryfikacji
          </Txt>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt f="b7" size={17} style={{ fontVariant: ['tabular-nums'] }}>
          {fmtContestScore(kind, e.score)}
        </Txt>
        <Txt f="n7" size={11} color={colors.faint}>
          {secondary}
        </Txt>
      </View>
      {onMore && !e.isMine ? (
        <Pressable onPress={() => onMore(e)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Więcej – zgłoś okaz">
          <Icon name="more_vert" size={20} color={colors.faint} />
        </Pressable>
      ) : null}
      {zoom ? <EntryPhoto entry={e} uri={uri} tint={rarity.color} title={sp?.name ?? ''} onClose={() => setZoom(false)} /> : null}
    </View>
  );
});

/** Powiększone zdjęcie okazu (tap w miniaturę) – podpis: gatunek, kapelusz, autor. */
function EntryPhoto({
  entry,
  uri,
  tint,
  title,
  onClose,
}: {
  entry: ContestEntry;
  uri?: string;
  tint: string;
  title: string;
  onClose: () => void;
}) {
  const source = useFindPhotoSource(uri);
  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij zdjęcie" />
        <View style={styles.card}>
          <Placeholder
            source={source}
            tile={{ tint, glyph: 'mushroom', glyphSize: 96 }}
            style={{ width: '100%', aspectRatio: 1, borderRadius: 20, overflow: 'hidden' }}
          />
          <View style={{ gap: 2, alignItems: 'center' }}>
            <Txt f="b7" size={20} align="center">
              {title}
            </Txt>
            <Txt f="n7" size={13} color={colors.muted} align="center">
              Kapelusz {fmtCm(entry.capCm)} · {fmtPct(entry.relativePct)} typowego ·{' '}
              {entry.isMine ? 'Twój okaz' : entry.author.name}
            </Txt>
          </View>
          <Pressable onPress={onClose} hitSlop={6} style={({ pressed }) => ({ paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
            <Txt f="b7" size={16} color={colors.outlineText}>
              Zamknij
            </Txt>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(30,38,25,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: 28,
    padding: 16,
    gap: 12,
    alignItems: 'center',
    boxShadow: shadows.dialog,
  },
});
