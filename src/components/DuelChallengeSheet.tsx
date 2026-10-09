import { router, type Href } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAsync } from '@/hooks/useAsync';
import { ServiceError, useServices } from '@/services';
import { ui } from '@/store/useUiStore';
import { colors, shadows } from '@/theme/tokens';
import type { Duel, DuelDays, DuelKind, SocialUser } from '@/types';
import {
  DUEL_COMMON_RULE,
  DUEL_DAYS,
  DUEL_KIND_ORDER,
  DUEL_KINDS,
  DUEL_XP_RULE,
  daysLabel,
} from '@/utils/duels';
import { uuid } from '@/utils/random';
import { Avatar, authorRingColor } from './Avatar';
import { Button3D } from './Button3D';
import { Icon } from './Icon';
import { SegmentedControl } from './SegmentedControl';
import { Bone } from './Skeleton';
import { Txt } from './Txt';

export interface DuelChallengePreset {
  opponentId?: string;
  kind?: DuelKind;
  days?: DuelDays;
}

interface DuelChallengeSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Rewanż / mini profil znajomego: przeciwnik, rodzaj i czas wybrane z góry. */
  preset?: DuelChallengePreset;
  /** Znajomi z pojedynkiem w toku (jeden na parę) – nie do wybrania. */
  busyIds?: string[];
  onCreated?: (duel: Duel) => void;
}

/**
 * Arkusz „Wyzwij na pojedynek” (od dołu, jak wybór województwa): znajomy → rodzaj (z krótkimi zasadami) → czas
 * (1 / 3 / 7 dni) → „Wyślij wyzwanie”. Znajomi z FeedService.getFriendsOverview (zablokowanych tam nie ma).
 */
export function DuelChallengeSheet({ visible, onClose, preset, busyIds, onCreated }: DuelChallengeSheetProps) {
  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {visible ? <SheetBody onClose={onClose} preset={preset} busyIds={busyIds ?? []} onCreated={onCreated} /> : null}
    </Modal>
  );
}

function SheetBody({
  onClose,
  preset,
  busyIds,
  onCreated,
}: Omit<DuelChallengeSheetProps, 'visible' | 'busyIds'> & { busyIds: string[] }) {
  const { feed, duels } = useServices();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const friends = useAsync(() => feed.getFriendsOverview().then((o) => o.friends), []);
  const [opponentId, setOpponentId] = useState<string | null>(preset?.opponentId ?? null);
  const [kind, setKind] = useState<DuelKind>(preset?.kind ?? 'biggest');
  const [days, setDays] = useState<DuelDays>(preset?.days ?? 3);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = friends.data ?? [];
  // Wybór liczony przy każdym renderze: lista pojedynków w toku może przyjść po otwarciu arkusza (wejście z mini
  // profilu) – znajomy z pojedynkiem w toku przestaje być wybrany, a przycisk wysyłki jest nieaktywny.
  const opponent = list.find((f) => f.id === opponentId && !busyIds.includes(f.id));

  /**
   * Id wyzwania nadane raz na wybór (znajomy + rodzaj + czas): ponowne „Wyzwij” po błędzie sieci wysyła to samo id,
   * więc wyzwanie zapisane mimo zerwanej odpowiedzi nie zamienia się w „masz już pojedynek z tą osobą”.
   */
  const attempt = useRef<{ key: string; id: string } | null>(null);

  const send = async () => {
    if (!opponent || sending) return;
    setSending(true);
    setError(null);
    const key = `${opponent.id}:${kind}:${days}`;
    if (attempt.current?.key !== key) attempt.current = { key, id: uuid() };
    try {
      const duel = await duels.createDuel(opponent.id, kind, days, attempt.current.id);
      onClose();
      onCreated?.(duel);
      ui.toast(`Wyzwanie wysłane: ${opponent.name}`, 'bolt');
    } catch (e) {
      const network = e instanceof ServiceError && e.code === 'NETWORK';
      setError(network ? 'Brak połączenia – spróbuj ponownie.' : e instanceof Error ? e.message : 'Nie udało się wysłać wyzwania.');
    } finally {
      setSending(false);
    }
  };

  const findFriends = () => {
    onClose();
    router.push('/znajomi' as Href);
  };

  return (
    <Animated.View entering={FadeIn.duration(160)} style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij wyzwanie" />
      <Animated.View
        entering={SlideInDown.duration(240)}
        style={[styles.sheet, { maxHeight: Math.round(height * 0.9), paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <View style={styles.grabber} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 }}>
          <View style={{ flex: 1 }}>
            <Txt f="b7" size={24}>
              Wyzwij na pojedynek
            </Txt>
            <Txt f="n7" size={13} color={colors.muted}>
              Kto zbierze więcej – Ty czy znajomy?
            </Txt>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Zamknij">
            <Icon name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8, gap: 18 }} keyboardShouldPersistTaps="handled">
          <Step n={1} title="Z kim?">
            {friends.error ? (
              <View style={{ gap: 8 }}>
                <Txt f="n6" size={14} color={colors.muted}>
                  Brak połączenia – nie udało się wczytać znajomych.
                </Txt>
                <TextButton label="Spróbuj ponownie" onPress={friends.reload} />
              </View>
            ) : !friends.data ? (
              <View style={{ flexDirection: 'row', gap: 12 }}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={{ alignItems: 'center', gap: 6 }}>
                    <Bone w={52} h={52} r={26} />
                    <Bone w={48} h={10} />
                  </View>
                ))}
              </View>
            ) : list.length === 0 ? (
              <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 14, gap: 8, boxShadow: shadows.card }}>
                <Txt f="n8" size={15}>
                  Nie masz jeszcze znajomych
                </Txt>
                <Txt f="n6" size={13} color={colors.muted}>
                  Pojedynki rozgrywasz ze znajomymi – zaproś kogoś albo znajdź po nicku.
                </Txt>
                <TextButton label="Znajdź znajomych" onPress={findFriends} />
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 2 }}>
                {list.map((f) => (
                  <FriendChip key={f.id} user={f} selected={f.id === opponent?.id} busy={busyIds.includes(f.id)} onPress={() => setOpponentId(f.id)} />
                ))}
              </ScrollView>
            )}
          </Step>

          <Step n={2} title="Rodzaj pojedynku">
            <View style={{ gap: 8 }}>
              {DUEL_KIND_ORDER.map((k) => (
                <KindOption key={k} kind={k} selected={k === kind} onPress={() => setKind(k)} />
              ))}
            </View>
          </Step>

          <Step n={3} title="Ile trwa?">
            <SegmentedControl
              value={String(days)}
              onChange={(v) => setDays(Number(v) as DuelDays)}
              options={DUEL_DAYS.map((d) => ({ value: String(d), label: daysLabel(d) }))}
            />
            <Txt f="n6" size={12} color={colors.muted} style={{ marginTop: 6 }}>
              Liczymy od chwili, gdy znajomy przyjmie wyzwanie. Zaproszenie jest ważne 48 h.
            </Txt>
          </Step>

          <View style={{ backgroundColor: colors.primaryTint, borderRadius: 18, padding: 12, flexDirection: 'row', gap: 10 }}>
            <Icon name="verified" filled size={20} color={colors.primaryText} />
            <Txt f="n6" size={12} color={colors.primaryTintBody} style={{ flex: 1 }}>
              {DUEL_COMMON_RULE} {DUEL_XP_RULE}
            </Txt>
          </View>

          {error ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <Icon name="error" filled size={18} color={colors.danger} />
              <Txt f="n7" size={13} color={colors.dangerText} style={{ flex: 1 }}>
                {error}
              </Txt>
            </View>
          ) : null}
        </ScrollView>

        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <Button3D
            title={opponent ? `Wyzwij: ${opponent.name}` : 'Wybierz znajomego'}
            icon="bolt"
            size="md"
            disabled={!opponent}
            loading={sending}
            onPress={() => void send()}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={styles.stepNo}>
          <Txt f="b7" size={13} color={colors.primaryInk}>
            {n}
          </Txt>
        </View>
        <Txt f="b7" size={18}>
          {title}
        </Txt>
      </View>
      {children}
    </View>
  );
}

function FriendChip({ user, selected, busy, onPress }: { user: SocialUser; selected: boolean; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={busy ? undefined : onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: busy }}
      accessibilityLabel={busy ? `${user.name} – pojedynek w toku` : user.name}
      style={({ pressed }) => ({ width: 72, alignItems: 'center', gap: 4, opacity: busy ? 0.45 : pressed ? 0.75 : 1 })}
    >
      <View style={{ borderRadius: 30, padding: 2, borderWidth: 2.5, borderColor: selected ? colors.primary : 'transparent' }}>
        <Avatar size={50} ringWidth={2.5} ringColor={authorRingColor(user)} avatar={user.avatar} />
        {selected ? (
          <View style={styles.check}>
            <Icon name="check_circle" filled size={20} color={colors.primary} />
          </View>
        ) : null}
      </View>
      <Txt f="n8" size={12} align="center" numberOfLines={1} color={selected ? colors.primaryText : colors.ink}>
        {user.name}
      </Txt>
      {busy ? (
        <Txt f="n7" size={10} align="center" color={colors.muted} numberOfLines={1}>
          w pojedynku
        </Txt>
      ) : null}
    </Pressable>
  );
}

function KindOption({ kind, selected, onPress }: { kind: DuelKind; selected: boolean; onPress: () => void }) {
  const def = DUEL_KINDS[kind];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${def.label}. ${def.rule}`}
      style={({ pressed }) => ({
        backgroundColor: pressed ? '#FDFBF6' : colors.card,
        borderRadius: 18,
        padding: 12,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        boxShadow: shadows.card,
        borderWidth: 2.5,
        borderColor: selected ? colors.primary : 'transparent',
      })}
    >
      <View style={[styles.kindTile, selected && { backgroundColor: colors.primaryTint }]}>
        <Icon name={def.icon} filled size={22} color={selected ? colors.primaryText : colors.outlineText} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt f="n8" size={15}>
          {def.label}
        </Txt>
        <Txt f="n6" size={12} color={colors.muted}>
          {def.rule}
        </Txt>
      </View>
      <Icon name={selected ? 'check_circle' : 'radio_button_unchecked'} filled={selected} size={22} color={selected ? colors.primary : colors.disabled} />
    </Pressable>
  );
}

function TextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        alignSelf: 'flex-start',
        borderWidth: 2.5,
        borderColor: colors.outline,
        borderRadius: 16,
        paddingVertical: 7,
        paddingHorizontal: 14,
        backgroundColor: pressed ? colors.outlineHover : 'transparent',
      })}
    >
      <Txt f="b7" size={15} color={colors.outlineText}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(30,27,22,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    gap: 4,
    boxShadow: shadows.dialog,
  },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.outline, marginBottom: 8 },
  stepNo: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  kindTile: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', right: -4, bottom: -4, backgroundColor: colors.bg, borderRadius: 12 },
});
