import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, Share, TextInput, View } from 'react-native';

import { Avatar, authorRingColor } from '@/components/Avatar';
import { Button3D, hapticLight } from '@/components/Button3D';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { PlayerSheet } from '@/components/PlayerSheet';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { SkeletonRow } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { friendActionFailed, runFriendAction } from '@/store/friends';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, fonts, shadows } from '@/theme/tokens';
import type { FriendStatus, PostAuthor, SocialUser } from '@/types';
import { gminaTitle } from '@/utils/format';
import { effectiveStatus, EMPTY_OVERVIEW, friendButton, moveTo, optimisticStatus, type FriendAction } from '@/utils/friends';
import { inviteLink, inviteMessage } from '@/utils/social';

/**
 * Znajomi (push z feedu / powiadomienia): zaproszenia do gracza („Akceptuj” / „Odrzuć”), zaproszenie linkiem,
 * wyszukiwarka grzybiarzy (przycisk zależny od relacji), wysłane zaproszenia („Anuluj”) i lista znajomych.
 * W mockach zaproszeń nie ma – dodanie działa od razu, więc sekcje zaproszeń się nie pokazują.
 */
export default function FriendsScreen() {
  const { feed } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const user = useUserStore((s) => s.user);
  const overview = useAsync(() => feed.getFriendsOverview(), [network]);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const results = useAsync(() => feed.searchUsers(search), [search, network]);
  const [focused, setFocused] = useState(false);
  /** Osoby, dla których trwa zapis (przycisk nieaktywny). */
  const [busy, setBusy] = useState<string[]>([]);
  /** Relacje zmienione na tym ekranie (wyniki wyszukiwania pokazują je od razu). */
  const [overrides, setOverrides] = useState<Record<string, FriendStatus>>({});
  const [profileOf, setProfileOf] = useState<PostAuthor | null>(null);

  // Szukamy po chwili przerwy w pisaniu (debounce 300 ms).
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/feed'));
  const statusOf = (u: SocialUser) => effectiveStatus(overview.data, u, overrides);
  const withBusy = async (id: string, fn: () => Promise<void>) => {
    setBusy((b) => [...b, id]);
    try {
      await fn();
    } finally {
      setBusy((b) => b.filter((x) => x !== id));
    }
  };
  const setOverride = (id: string, status: FriendStatus | undefined) =>
    setOverrides((m) => {
      const next = { ...m };
      if (status) next[id] = status;
      else delete next[id];
      return next;
    });

  /** Akcja z UI optymistycznym: listy od razu, po odpowiedzi – status z serwera, przy błędzie – cofnięcie. */
  const act = (u: SocialUser, action: FriendAction) =>
    withBusy(u.id, async () => {
      hapticLight();
      const before = overview.data;
      const prevOverride = overrides[u.id];
      const optimistic = optimisticStatus(action, statusOf(u), !!feed.twoSidedFriends);
      overview.setData((o) => moveTo(o ?? EMPTY_OVERVIEW, u, optimistic));
      setOverride(u.id, optimistic);
      try {
        const status = await runFriendAction(feed, u, action);
        overview.setData((o) => moveTo(o ?? EMPTY_OVERVIEW, u, status));
        setOverride(u.id, status);
      } catch (e) {
        overview.setData(() => before);
        setOverride(u.id, prevOverride);
        friendActionFailed(action, e);
      }
    });

  const remove = (u: SocialUser) =>
    ui.confirm({
      title: `Usunąć ${u.name} ze znajomych?`,
      message: 'Wyprawy tej osoby znikną z zakładki „Znajomi”. Możesz dodać ją ponownie w każdej chwili.',
      icon: 'person_remove',
      confirmLabel: 'Usuń',
      danger: true,
      onConfirm: () => act(u, 'remove'),
    });

  const retry = () => {
    overview.reload();
    results.reload();
  };
  const offline = !!(overview.error || results.error);
  const searching = query.trim() !== search || (results.loading && !!results.data);
  const friends = overview.data?.friends;
  const incoming = overview.data?.incoming ?? [];
  const outgoing = overview.data?.outgoing ?? [];
  const friendCount = friends?.length ?? 0;

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Znajomi
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        {!offline && incoming.length ? (
          <Section title="Zaproszenia" count={String(incoming.length)}>
            <View style={{ gap: 10 }}>
              {incoming.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  onPress={() => setProfileOf(u)}
                  footer={
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <ActionButton icon="group_add" label="Akceptuj" disabled={busy.includes(u.id)} onPress={() => act(u, 'accept')} />
                      <ActionButton icon="close" label="Odrzuć" outline disabled={busy.includes(u.id)} onPress={() => act(u, 'reject')} />
                    </View>
                  }
                >
                  <Txt f="n8" size={12} color={colors.primaryText}>
                    zaprasza Cię
                  </Txt>
                </UserRow>
              ))}
            </View>
          </Section>
        ) : null}

        <InviteCard firstName={user.firstName} handle={user.handle} />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            minHeight: 50,
            paddingHorizontal: 14,
            backgroundColor: colors.card,
            borderRadius: 18,
            borderWidth: 2,
            borderColor: focused ? colors.primary : colors.card,
            boxShadow: shadows.card,
          }}
        >
          <Icon name="search" size={22} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Szukaj po nicku lub imieniu"
            placeholderTextColor={colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => setSearch(query.trim())}
            accessibilityLabel="Szukaj grzybiarzy"
            style={{ flex: 1, fontFamily: fonts.nunito600, fontSize: 15, color: colors.ink, paddingVertical: 12, outlineWidth: 0 }}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Wyczyść">
              <Icon name="cancel" filled size={20} color={colors.faint} />
            </Pressable>
          ) : null}
        </View>

        {offline ? (
          <OfflineCard onRetry={retry} />
        ) : (
          <>
            <Section title={query.trim() ? 'Wyniki wyszukiwania' : 'Mogą Cię znać'}>
              {!results.data ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : results.data.length === 0 ? (
                <StateCard
                  icon="search"
                  title={search ? 'Nikogo nie znaleziono' : 'Znasz już wszystkich!'}
                  text={search ? 'Sprawdź pisownię nicku albo wyślij zaproszenie.' : 'Zaproś kolejne osoby linkiem powyżej.'}
                />
              ) : (
                <View style={{ gap: 10, opacity: searching ? 0.55 : 1 }}>
                  {results.data.map((u) => (
                    <UserRow key={u.id} user={u} onPress={() => setProfileOf(u)}>
                      <ResultButton status={statusOf(u)} disabled={busy.includes(u.id)} onAction={(a) => act(u, a)} />
                    </UserRow>
                  ))}
                </View>
              )}
            </Section>

            {outgoing.length ? (
              <Section title="Wysłane" count={String(outgoing.length)}>
                <View style={{ gap: 10 }}>
                  {outgoing.map((u) => (
                    <UserRow key={u.id} user={u} onPress={() => setProfileOf(u)}>
                      <ActionButton icon="undo" label="Anuluj" outline compact disabled={busy.includes(u.id)} onPress={() => act(u, 'cancel')} />
                    </UserRow>
                  ))}
                </View>
              </Section>
            ) : null}

            <Section title="Twoi znajomi" count={friends ? String(friendCount) : undefined}>
              {!friends ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : friendCount === 0 ? (
                <StateCard
                  icon="group"
                  title="Nie masz jeszcze znajomych"
                  text="Wyszukaj grzybiarzy po nicku albo wyślij zaproszenie – ich wyprawy pojawią się w feedzie."
                />
              ) : (
                <View style={{ gap: 10 }}>
                  {friends.map((u) => (
                    <UserRow key={u.id} user={u} onPress={() => setProfileOf(u)}>
                      <IconButton
                        icon="person_remove"
                        size={38}
                        iconSize={20}
                        onPress={busy.includes(u.id) ? undefined : () => remove(u)}
                        style={{ backgroundColor: colors.canvas, boxShadow: undefined }}
                        accessibilityLabel={`Usuń ${u.name} ze znajomych`}
                      />
                    </UserRow>
                  ))}
                </View>
              )}
            </Section>
          </>
        )}
      </View>
      <PlayerSheet
        author={profileOf}
        onClose={() => setProfileOf(null)}
        onFriendChange={(u) => {
          setOverride(u.id, u.friendStatus);
          overview.reload();
          results.reload();
        }}
        // Zablokowany znika ze znajomych, zaproszeń i wyników wyszukiwania (serwer już go pomija).
        onBlockChange={() => {
          overview.reload();
          results.reload();
        }}
      />
    </Screen>
  );
}

function Section({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader title={title} count={count} />
      {children}
    </View>
  );
}

function UserRow({
  user: u,
  onPress,
  children,
  footer,
}: {
  user: SocialUser;
  onPress: () => void;
  children?: ReactNode;
  /** Przyciski pod wierszem (zaproszenie: „Akceptuj” / „Odrzuć”). */
  footer?: ReactNode;
}) {
  const gmina = useCatalogStore((s) => s.gminaById[u.homeGminaId]);
  // Serwer nie udostępnia imienia i nazwiska innych – wtedy pod nickiem jest @nick.
  const sub = [u.fullName || u.handle, gmina ? gminaTitle(gmina) : ''].filter(Boolean).join(' · ');
  // Przycisk akcji jest obok (nie wewnątrz) obszaru profilu – na webie <button> nie może zawierać <button>.
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 12, gap: 10, boxShadow: shadows.card }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Profil: ${u.name}`}
          style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: pressed ? 0.7 : 1 })}
        >
          <Avatar size={42} ringColor={authorRingColor(u)} avatar={u.avatar} />
          <View style={{ flex: 1 }}>
            <Txt f="n8" size={15} numberOfLines={1}>
              {u.name}{' '}
              <Txt f="n7" size={14} color={colors.muted}>
                · Lv {u.level}
              </Txt>
            </Txt>
            <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
              {sub}
            </Txt>
          </View>
        </Pressable>
        {children}
      </View>
      {footer}
    </View>
  );
}

/** Przycisk przy wyniku wyszukiwania: „Dodaj” / „Wysłano” / „Akceptuj” / „Znajomi”. */
function ResultButton({ status, disabled, onAction }: { status: FriendStatus; disabled?: boolean; onAction: (a: FriendAction) => void }) {
  switch (friendButton(status)) {
    case 'friends':
      return <Pill label="Znajomi" icon="check" iconSize={17} padV={7} padH={12} />;
    case 'sent':
      return <Pill label="Wysłano" icon="send" iconSize={16} padV={7} padH={12} bg={colors.chip} color={colors.tagNeutralText} />;
    case 'accept':
      return <ActionButton icon="group_add" label="Akceptuj" compact disabled={disabled} onPress={() => onAction('accept')} />;
    default:
      return <ActionButton icon="person_add" label="Dodaj" compact disabled={disabled} onPress={() => onAction('request')} />;
  }
}

/**
 * Mały przycisk 3D (zielony) albo obrysowany. `compact` – przy wierszu (szerokość z treści),
 * bez niego – pół szerokości karty (dwa przyciski pod zaproszeniem).
 */
function ActionButton({
  icon,
  label,
  onPress,
  disabled,
  outline,
  compact,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  outline?: boolean;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flex: compact ? undefined : 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        backgroundColor: outline ? (pressed ? colors.outlineHover : 'transparent') : colors.primary,
        borderWidth: outline ? 2 : 0,
        borderColor: colors.outline,
        borderRadius: 999,
        paddingVertical: outline ? 5 : 7,
        paddingHorizontal: 12,
        boxShadow: outline ? undefined : `0px ${pressed ? 1 : 3}px 0px ${colors.primaryShadow}`,
        transform: [{ translateY: pressed && !outline ? 2 : 0 }],
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <Icon name={icon} size={17} color={outline ? colors.outlineText : colors.primaryInk} />
      <Txt f="n8" size={13} color={outline ? colors.outlineText : colors.primaryInk}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** Ciemna karta zaproszenia: link do skopiowania (web) i systemowe „Udostępnij”. */
function InviteCard({ firstName, handle }: { firstName: string; handle: string }) {
  const url = inviteLink(handle);
  const web = Platform.OS === 'web';
  return (
    <Card dark radius={26} padding={18} gap={14}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 16,
            backgroundColor: 'rgba(255,255,255,0.12)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="group_add" filled size={28} color={colors.xpOnDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt f="b7" size={20} color={colors.onDark} lh={1.2}>
            Zaproś znajomych
          </Txt>
          <Txt f="n6" size={13} color={colors.onDarkMuted}>
            Po dołączeniu zobaczycie nawzajem swoje wyprawy w feedzie.
          </Txt>
        </View>
      </View>
      <Pressable
        onPress={() => (web ? copyLink(url) : shareInvite(firstName, handle))}
        accessibilityRole="button"
        accessibilityLabel={web ? 'Kopiuj link zaproszenia' : 'Udostępnij link zaproszenia'}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: pressed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.1)',
          borderRadius: 14,
          paddingVertical: 10,
          paddingHorizontal: 12,
        })}
      >
        <Icon name="link" size={18} color={colors.xpOnDark} />
        <Txt f="n7" size={13} color={colors.onDarkSoft} numberOfLines={1} style={{ flex: 1 }}>
          {url.replace(/^https:\/\//, '')}
        </Txt>
        <Icon name={web ? 'content_copy' : 'ios_share'} size={18} color={colors.onDarkSoft} />
      </Pressable>
      <Button3D title="Udostępnij zaproszenie" icon="share" size="md" onDark onPress={() => shareInvite(firstName, handle)} />
    </Card>
  );
}

/** Web: schowek przeglądarki (wymaga https albo localhost); bez niego pokazujemy link w toaście. */
async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    ui.toast('Link skopiowany', 'content_copy');
  } catch {
    ui.toast(url, 'link');
  }
}

/** iOS / Android: systemowy arkusz udostępniania; web: Web Share API, a bez niego – kopiowanie linku. */
async function shareInvite(firstName: string, handle: string) {
  const url = inviteLink(handle);
  const message = inviteMessage(firstName, handle);
  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Grzybobranie', text: message, url });
        return;
      } catch (e) {
        // Zamknięty arkusz to nie błąd; inny błąd (np. brak uprawnień) → kopiujemy link.
        if (e instanceof Error && e.name === 'AbortError') return;
      }
    }
    return copyLink(url);
  }
  try {
    // iOS dokleja `url` jako osobny element (podgląd linku); Android ma tylko `message`.
    await Share.share(Platform.OS === 'ios' ? { message, url } : { message: `${message}\n${url}`, title: 'Zaproszenie do Grzybobrania' });
  } catch {
    ui.toast('Nie udało się otworzyć udostępniania', 'error');
  }
}
