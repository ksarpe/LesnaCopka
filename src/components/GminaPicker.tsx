import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { gminaFromMeta, gminaIndex, type GminaMeta } from '@/geo';
import { useRegionStore } from '@/hooks/useRegion';
import { useCatalogStore } from '@/store/useCatalogStore';
import { colors } from '@/theme/tokens';
import type { Gmina } from '@/types';
import { gminaSubtitle, gminaTitle } from '@/utils/format';
import { searchByName } from '@/utils/profile';
import { Icon } from './Icon';
import { SettingsGroup } from './Settings';
import { TextField } from './TextField';
import { Txt } from './Txt';

/** Wiersz listy: gmina z danymi gry (katalog) albo dowolna gmina w Polsce z indeksu PRG. */
export interface GminaOption {
  id: string;
  title: string;
  sub: string;
  gmina?: Gmina;
  meta?: GminaMeta;
}

export const optionFromGmina = (g: Gmina): GminaOption => ({ id: g.id, title: gminaTitle(g), sub: gminaSubtitle(g), gmina: g });
const fromMeta = (m: GminaMeta): GminaOption => ({ id: m.id, title: gminaTitle(m), sub: gminaSubtitle(m), meta: m });

/** Gmina spoza danych gry → do katalogu (nazwa, powiat, lesistość z PRG), żeby ekrany znały jej nazwę. */
export function ensureGminaInCatalog(o: GminaOption) {
  const g = o.gmina ?? (o.meta ? gminaFromMeta(o.meta) : null);
  if (g && !useCatalogStore.getState().gminaById[o.id]) useCatalogStore.getState().upsertGmina(g);
}

interface GminaPickerProps {
  /** Zaznaczona gmina (null = jeszcze żadna). */
  selectedId: string | null;
  /** Wybór (gmina już jest w katalogu). */
  onSelect: (o: GminaOption) => void;
  /** Nagłówek grupy z zaznaczoną gminą: „Obecnie” (Ustawienia) / „Wybrana” (onboarding). */
  selectedTitle?: string;
}

/**
 * Wybór gminy (Ustawienia → Gmina domowa, onboarding): wyszukiwarka wszystkich 2479 gmin (indeks PRG), a bez frazy –
 * zaznaczona gmina, gmina z ostatniego wykrycia GPS i gminy z danymi gry.
 */
export function GminaPicker({ selectedId, onSelect, selectedTitle = 'Obecnie' }: GminaPickerProps) {
  const gminy = useCatalogStore((s) => s.gminy);
  const gminaById = useCatalogStore((s) => s.gminaById);
  const detected = useRegionStore((s) => s.region?.gmina);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<GminaMeta[] | null>(null);
  const [indexFailed, setIndexFailed] = useState(false);

  // Indeks PRG (~250 KB) – ten sam, którego używa wykrywanie gminy; po pierwszym wczytaniu jest w pamięci.
  useEffect(() => {
    let alive = true;
    gminaIndex()
      .then((ix) => alive && setIndex(ix.list))
      .catch(() => alive && setIndexFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const searching = query.trim().length > 0;
  const results = useMemo(() => {
    if (!searching) return [];
    const inGame = searchByName(gminy, query);
    const ids = new Set(inGame.map((g) => g.id));
    const all = index ? searchByName(index, query).filter((m) => !ids.has(m.id)) : [];
    return [...inGame.map(optionFromGmina), ...all.map(fromMeta)].slice(0, 40);
  }, [searching, gminy, index, query]);

  const catalogList = useMemo(
    () => [...gminy].sort((a, b) => a.name.localeCompare(b.name, 'pl')).filter((g) => g.id !== selectedId).map(optionFromGmina),
    [gminy, selectedId],
  );
  const current = selectedId ? gminaById[selectedId] : undefined;

  const pick = (o: GminaOption) => {
    ensureGminaInCatalog(o);
    onSelect(o);
  };

  return (
    <View style={{ gap: 18 }}>
      <TextField
        icon="search"
        value={query}
        onChangeText={setQuery}
        placeholder="Szukaj gminy w całej Polsce"
        autoCapitalize="words"
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel="Szukaj gminy"
        right={
          query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Wyczyść">
              <Icon name="cancel" filled size={20} color={colors.disabled} />
            </Pressable>
          ) : null
        }
      />

      {searching ? (
        results.length ? (
          <SettingsGroup>
            {results.map((o) => (
              <GminaRow key={o.id} option={o} selected={o.id === selectedId} onPress={() => pick(o)} />
            ))}
          </SettingsGroup>
        ) : index || indexFailed ? (
          <Txt f="n7" size={14} color={colors.muted} align="center" style={{ paddingVertical: 12 }}>
            {indexFailed ? 'Nie znaleziono gminy wśród gmin z danymi gry' : 'Nie znaleziono gminy o tej nazwie'}
          </Txt>
        ) : (
          <ActivityIndicator color={colors.primary} style={{ paddingVertical: 12 }} />
        )
      ) : (
        <>
          {selectedId ? (
            <SettingsGroup title={selectedTitle}>
              <GminaRow
                option={current ? optionFromGmina(current) : { id: selectedId, title: selectedId, sub: '' }}
                selected
                onPress={() => pick(current ? optionFromGmina(current) : { id: selectedId, title: selectedId, sub: '' })}
              />
            </SettingsGroup>
          ) : null}
          {detected && detected.id !== selectedId ? (
            <SettingsGroup title="Jesteś teraz w">
              <GminaRow option={optionFromGmina(detected)} icon="my_location" onPress={() => pick(optionFromGmina(detected))} />
            </SettingsGroup>
          ) : null}
          {catalogList.length ? (
            <SettingsGroup title="Gminy z danymi gry">
              {catalogList.map((o) => (
                <GminaRow key={o.id} option={o} onPress={() => pick(o)} />
              ))}
            </SettingsGroup>
          ) : null}
        </>
      )}
    </View>
  );
}

function GminaRow({
  option,
  selected,
  icon = 'location_on',
  onPress,
}: {
  option: GminaOption;
  selected?: boolean;
  icon?: 'location_on' | 'my_location';
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={option.title}>
      {({ pressed }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            paddingVertical: 11,
            paddingHorizontal: 14,
            minHeight: 60,
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
              backgroundColor: selected ? colors.primary : colors.primaryTint,
            }}
          >
            <Icon name={selected ? 'home_pin' : icon} filled size={22} color={selected ? colors.primaryInk : colors.primaryText} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt f="n8" size={15} numberOfLines={1}>
              {option.title}
            </Txt>
            {option.sub ? (
              <Txt f="n6" size={12} color={colors.muted} numberOfLines={1}>
                {option.sub}
              </Txt>
            ) : null}
          </View>
          {selected ? <Icon name="check_circle" filled size={22} color={colors.primary} /> : null}
        </View>
      )}
    </Pressable>
  );
}
