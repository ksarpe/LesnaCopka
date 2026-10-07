import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, authorRingColor } from '@/components/Avatar';
import { hapticLight } from '@/components/Button3D';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { PlayerSheet } from '@/components/PlayerSheet';
import { SkeletonCard, SkeletonRow } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { UiHost } from '@/components/UiHost';
import { UserAvatar } from '@/components/UserAvatar';
import { useAsync } from '@/hooks/useAsync';
import { useTopInset } from '@/hooks/useInsets';
import { useNow } from '@/hooks/useNow';
import { ServiceError, useServices } from '@/services';
import { confirmBlock } from '@/store/block';
import { noteSocial } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useFeedSync } from '@/store/useFeedSync';
import { useSimStore } from '@/store/useSimStore';
import { ui, useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, fonts, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { Post, PostAuthor, PostComment } from '@/types';
import { fmtAgo, fmtDurationShort, fmtInt, fmtKm, gminaTitle, plural } from '@/utils/format';
import { uuid } from '@/utils/random';
import { COMMENT_COUNTER_FROM, COMMENT_MAX, failText, isLocalPost, prepareComment } from '@/utils/social';

/** Komentarz wysłany optymistycznie – czeka na potwierdzenie serwisu. */
const PENDING = 'tmp-';
const isPending = (c: PostComment) => c.id.startsWith(PENDING);
/** Pole tekstowe rośnie do ~4 linii, dalej przewija się w środku. */
const INPUT_MAX_H = 108;

/** Komentarze wpisu (push z feedu): podsumowanie wpisu, lista i pole komentarza nad klawiaturą. */
export default function CommentsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { feed } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const post = useAsync(() => feed.getPost(postId), [postId, network]);
  const comments = useAsync(() => feed.getComments(postId), [postId, network]);
  const user = useUserStore((s) => s.user);
  const top = useTopInset();
  const insets = useSafeAreaInsets();
  const now = useNow(60_000);

  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const [kbHeight, setKbHeight] = useState(0);
  const [composerH, setComposerH] = useState(70);
  const [profileOf, setProfileOf] = useState<PostAuthor | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  const list = comments.data;
  const ready = !!post.data && !!list && !post.error && !comments.error;
  const notFound = [post.error, comments.error].some((e) => e instanceof ServiceError && e.code === 'NOT_FOUND');

  // Klawiatura: na iOS KeyboardAvoidingView podnosi pole, my tylko chowamy odstęp home indicatora i przesuwamy toast.
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Web: <textarea> nie rośnie sama – wysokość z scrollHeight (też maleje po skasowaniu tekstu).
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = inputRef.current as unknown as HTMLTextAreaElement | null;
    if (!el?.style) return;
    el.rows = 1;
    el.style.height = 'auto';
    el.style.height = `${Math.min(INPUT_MAX_H, el.scrollHeight)}px`;
  }, [text, ready]);

  // Licznik w feedzie po każdej potwierdzonej zmianie (feed nakłada go po powrocie, bez czekania na sieć).
  useEffect(() => {
    if (!list || !postId) return;
    useFeedSync.getState().setCommentCount(postId, list.filter((c) => !isPending(c)).length);
  }, [list, postId]);

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/feed'));
  // Przewijamy po zmianie wysokości treści (onContentSizeChange) – sam timeout bywa za wczesny na webie.
  const stickToEnd = useRef(false);
  const scrollToEnd = () => {
    stickToEnd.current = true;
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };
  const retry = () => {
    post.reload();
    comments.reload();
  };

  const send = async () => {
    const body = prepareComment(text);
    if (!body || !list) return;
    const me: PostAuthor = { id: user.id, name: user.firstName, level: user.level, ringRarity: 'primary' };
    // Id komentarza nadaje telefon (UUID) – serwer nie zdubluje go przy ponowieniu.
    const clientId = uuid();
    const temp: PostComment = { id: `${PENDING}${clientId}`, postId, author: me, text: body, createdAt: new Date().toISOString(), mine: true };
    hapticLight();
    setText('');
    comments.setData((l) => [...(l ?? []), temp]);
    scrollToEnd();
    try {
      const saved = await feed.addComment(postId, body, clientId);
      comments.setData((l) => l?.map((c) => (c.id === temp.id ? saved : c)));
      // Osiągnięcie „Gawędziarz”.
      noteSocial('comment');
    } catch (e) {
      comments.setData((l) => l?.filter((c) => c.id !== temp.id));
      // Treść wraca do pola (o ile gracz nie zaczął pisać kolejnego komentarza).
      setText((cur) => cur || body);
      ui.toast(failText(e, 'Brak sieci – komentarz nie został wysłany'), 'wifi_off');
    }
  };

  const remove = (c: PostComment) =>
    ui.confirm({
      title: 'Usunąć komentarz?',
      message: 'Komentarz zniknie dla wszystkich.',
      icon: 'delete',
      confirmLabel: 'Usuń',
      danger: true,
      onConfirm: async () => {
        const idx = (comments.data ?? []).findIndex((x) => x.id === c.id);
        comments.setData((l) => l?.filter((x) => x.id !== c.id));
        try {
          await feed.deleteComment(postId, c.id);
          ui.toast('Komentarz usunięty', 'delete');
        } catch (e) {
          comments.setData((l) => {
            if (!l || l.some((x) => x.id === c.id)) return l;
            const next = [...l];
            next.splice(Math.max(0, Math.min(idx, next.length)), 0, c);
            return next;
          });
          ui.toast(failText(e, 'Brak sieci – komentarz nie został usunięty'), 'wifi_off');
        }
      },
    });

  const report = async (c: PostComment) => {
    ui.toast('Dziękujemy – zgłoszenie wysłane', 'flag');
    try {
      await feed.reportPost(postId, c.id);
    } catch (e) {
      ui.toast(failText(e, 'Brak sieci – zgłoszenie nie zostało wysłane'), 'wifi_off');
    }
  };

  /** Po zablokowaniu: jego komentarze znikają; zablokowany autor wpisu – wpis jest już niewidoczny, wracamy. */
  const onBlocked = (authorId: string) => {
    if (post.data?.author.id === authorId) {
      useFeedSync.getState().markStale();
      back();
      return;
    }
    comments.setData((l) => l?.filter((x) => x.author.id !== authorId));
  };

  const commentMenu = (c: PostComment) => {
    if (isPending(c)) return;
    if (c.mine) return remove(c);
    // Profil autora otwiera tapnięcie avatara (bez modala zaraz po dialogu – iOS nie pokaże dwóch naraz).
    useUiStore.getState().showDialog({
      title: c.author.name,
      message: c.text,
      actions: [
        { label: 'Zgłoś komentarz', style: 'danger', onPress: () => void report(c) },
        { label: `Zablokuj: ${c.author.name}`, style: 'danger', onPress: () => confirmBlock(feed, c.author, () => onBlocked(c.author.id)) },
        { label: 'Anuluj', style: 'cancel' },
      ],
    });
  };

  const onAuthor = (a: PostAuthor, mine?: boolean) => (mine || a.id === user.id ? router.navigate('/profil') : setProfileOf(a));

  // Web: Enter wysyła, Shift+Enter = nowa linia (na telefonie wysyła klawisz „Wyślij”).
  const onKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== 'web') return;
    const ne = e.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean };
    if (ne.key === 'Enter' && !ne.shiftKey && !ne.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  const canSend = !!prepareComment(text);
  const left = COMMENT_MAX - text.length;
  const ios = Platform.OS === 'ios';
  const count = list?.length ?? 0;
  const isMinePost = post.data?.kind === 'trip' && !!post.data.mine;
  const ownHidden = isMinePost && !!post.data && new Date(post.data.visibleFrom).getTime() > now;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={ios ? 'padding' : undefined}>
        <View style={{ paddingTop: top + 6, paddingHorizontal: 20, paddingBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
            <Txt f="b7" size={18}>
              Komentarze
            </Txt>
            <View style={{ width: 44 }} />
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          onContentSizeChange={() => {
            if (!stickToEnd.current) return;
            stickToEnd.current = false;
            scrollRef.current?.scrollToEnd({ animated: true });
          }}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 6, paddingBottom: 16, gap: 12 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={ios ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          {notFound ? (
            <StateCard
              icon="forest"
              title="Wpis niedostępny"
              text="Autor usunął ten wpis albo nie jest już widoczny."
              action="Wróć do feedu"
              onAction={back}
            />
          ) : post.error || comments.error ? (
            <OfflineCard onRetry={retry} />
          ) : !ready ? (
            <>
              <SkeletonCard lines={2} radius={22} />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          ) : (
            <>
              <PostSummary post={post.data!} onAuthor={(p) => onAuthor(p.author, p.kind === 'trip' && p.mine)} />
              {count === 0 ? (
                <StateCard
                  icon="forum"
                  title="Bądź pierwszy – napisz komentarz"
                  text={
                    ownHidden
                      ? 'Znajomi zobaczą Twój wpis za 24 h – wtedy pojawią się ich komentarze.'
                      : 'Pogratuluj zbiorów albo podpowiedz coś od siebie.'
                  }
                  action="Napisz komentarz"
                  onAction={() => inputRef.current?.focus()}
                />
              ) : (
                <>
                  <Txt f="n8" size={13} color={colors.muted} style={{ marginTop: 4 }}>
                    {count} {plural(count, 'komentarz', 'komentarze', 'komentarzy')}
                  </Txt>
                  {list!.map((c) => (
                    <CommentRow key={c.id} comment={c} now={now} onAuthor={onAuthor} onMenu={commentMenu} />
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>

        {ready ? (
          <View
            onLayout={(e) => setComposerH(e.nativeEvent.layout.height)}
            style={{
              backgroundColor: colors.card,
              boxShadow: shadows.tabBar,
              paddingHorizontal: 16,
              paddingTop: 10,
              paddingBottom: kbHeight > 0 ? 10 : Math.max(insets.bottom, 12),
              gap: 4,
            }}
          >
            {text.length >= COMMENT_COUNTER_FROM ? (
              <Txt f="n8" size={12} color={left <= 0 ? colors.danger : colors.muted} align="right" style={{ paddingRight: 56 }}>
                {left}
              </Txt>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
              <UserAvatar size={38} ringWidth={2.5} style={{ marginBottom: 3 }} />
              <View
                style={{
                  flex: 1,
                  minHeight: 44,
                  justifyContent: 'center',
                  borderRadius: 22,
                  borderWidth: 2,
                  borderColor: focused ? colors.primary : colors.outline,
                  backgroundColor: colors.bg,
                  paddingHorizontal: 14,
                }}
              >
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={setText}
                  placeholder="Napisz komentarz…"
                  placeholderTextColor={colors.faint}
                  multiline
                  maxLength={COMMENT_MAX}
                  returnKeyType="send"
                  submitBehavior={Platform.OS === 'web' ? undefined : 'submit'}
                  onSubmitEditing={Platform.OS === 'web' ? undefined : () => void send()}
                  onKeyPress={onKeyPress}
                  onFocus={() => {
                    setFocused(true);
                    if (count > 0) setTimeout(scrollToEnd, 250);
                  }}
                  onBlur={() => setFocused(false)}
                  accessibilityLabel="Treść komentarza"
                  style={{
                    fontFamily: fonts.nunito600,
                    fontSize: 15,
                    color: colors.ink,
                    maxHeight: INPUT_MAX_H,
                    paddingTop: 10,
                    paddingBottom: 10,
                    paddingHorizontal: 0,
                    textAlignVertical: 'top',
                    outlineWidth: 0,
                  }}
                />
              </View>
              <SendButton disabled={!canSend} onPress={() => void send()} />
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <PlayerSheet
        author={profileOf}
        onClose={() => setProfileOf(null)}
        onBlockChange={(a, blocked) => (blocked ? onBlocked(a.id) : retry())}
      />
      <UiHost toastBottom={(ready ? composerH : insets.bottom) + (ios ? kbHeight : 0) + 12} />
    </View>
  );
}

function SendButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Wyślij komentarz"
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: disabled ? colors.chip : colors.primary,
        boxShadow: disabled ? undefined : `0px ${pressed ? 1 : 3}px 0px ${colors.primaryShadow}`,
        transform: [{ translateY: pressed && !disabled ? 2 : 0 }],
      })}
    >
      <Icon name="send" filled size={20} color={disabled ? colors.disabled : colors.primaryInk} />
    </Pressable>
  );
}

/** Tytuł i liczby wpisu w jednej linii (różne rodzaje wpisów). */
function postLines(p: Post): { title: string; stats: string } {
  if (p.kind === 'trip') {
    return {
      title: p.title,
      stats: `${fmtKm(p.distanceKm)} · ${fmtDurationShort(p.durationMin)} · ${p.mushrooms} ${plural(p.mushrooms, 'grzyb', 'grzyby', 'grzybów')} · +${fmtInt(p.xp)} XP`,
    };
  }
  if (p.kind === 'compact') {
    return {
      title: 'Krótka wyprawa',
      stats: `${fmtKm(p.distanceKm)} · ${p.mushrooms} ${plural(p.mushrooms, 'grzyb', 'grzyby', 'grzybów')} · ${p.species} ${plural(p.species, 'gatunek', 'gatunki', 'gatunków')} · +${fmtInt(p.xp)} XP`,
    };
  }
  return { title: `Awans na Lv ${p.level}!`, stats: p.badgeName ? `+ odznaka „${p.badgeName}”` : 'Nowy poziom' };
}

function PostSummary({ post, onAuthor }: { post: Post; onAuthor: (p: Post) => void }) {
  const gmina = useCatalogStore((s) => s.gminaById[post.gminaId]);
  const now = useNow(60_000);
  const mine = post.kind === 'trip' && !!post.mine;
  const hidden = mine && new Date(post.visibleFrom).getTime() > now;
  const ring = authorRingColor(post.author);
  const { title, stats } = postLines(post);
  const when = hidden ? (isLocalPost(post.id) ? 'wysyłanie…' : 'widoczne za 24 h') : fmtAgo(post.createdAt, now);
  const hl = post.kind === 'trip' ? post.highlight : undefined;
  return (
    <Card radius={22} padding={14} gap={10}>
      <Pressable
        onPress={() => onAuthor(post)}
        accessibilityRole="button"
        accessibilityLabel={mine ? 'Twój profil' : `Profil: ${post.author.name}`}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.75 : 1 })}
      >
        {mine ? <UserAvatar size={38} ringColor={ring} /> : <Avatar size={38} ringColor={ring} avatar={post.author.avatar} />}
        <View style={{ flex: 1 }}>
          <Txt f="n8" size={14} numberOfLines={1}>
            {mine ? 'Ty' : post.author.name}{' '}
            <Txt f="n7" size={14} color={colors.muted}>
              · Lv {post.author.level}
            </Txt>
          </Txt>
          <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
            {gminaTitle(gmina)} · {when}
          </Txt>
        </View>
      </Pressable>
      <View style={{ gap: 2 }}>
        <Txt f="b7" size={18} lh={1.2}>
          {title}
        </Txt>
        <Txt f="n7" size={13} color={colors.bodyDark}>
          {stats}
        </Txt>
      </View>
      {post.kind === 'trip' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Pill
            label={`Darz grzyb! ${post.reactions}`}
            icon="forest"
            iconFilled
            iconSize={15}
            size={12}
            bg={post.reacted ? colors.primary : colors.primaryTint}
            color={post.reacted ? colors.primaryInk : colors.primaryTintText}
          />
          {hl ? (
            <Pill
              label={`${rarityTokens[hl.rarity].label} · ${hl.text}`}
              icon="diamond"
              iconFilled
              iconSize={14}
              size={12}
              bg={rarityTokens[hl.rarity].color}
              color={hl.rarity === 'legendarny' ? colors.legendBadgeInk : colors.rarityInk}
            />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function CommentRow({
  comment: c,
  now,
  onAuthor,
  onMenu,
}: {
  comment: PostComment;
  now: number;
  onAuthor: (a: PostAuthor, mine?: boolean) => void;
  onMenu: (c: PostComment) => void;
}) {
  const pending = isPending(c);
  return (
    <Pressable
      onLongPress={pending ? undefined : () => onMenu(c)}
      delayLongPress={350}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, opacity: pending ? 0.6 : 1 }}
    >
      <Pressable
        onPress={() => onAuthor(c.author, c.mine)}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={c.mine ? 'Twój profil' : `Profil: ${c.author.name}`}
      >
        {c.mine ? (
          <UserAvatar size={36} ringWidth={2.5} ringColor={colors.primary} />
        ) : (
          <Avatar size={36} ringWidth={2.5} ringColor={authorRingColor(c.author)} avatar={c.author.avatar} />
        )}
      </Pressable>
      <View
        style={{
          flex: 1,
          gap: 2,
          backgroundColor: c.mine ? colors.primaryTint : colors.card,
          borderRadius: 18,
          borderTopLeftRadius: 6,
          paddingVertical: 9,
          paddingHorizontal: 12,
          boxShadow: c.mine ? undefined : shadows.card,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt f="n8" size={14} numberOfLines={1} style={{ flexShrink: 1 }}>
            {c.mine ? 'Ty' : c.author.name}{' '}
            <Txt f="n7" size={13} color={colors.muted}>
              · Lv {c.author.level}
            </Txt>
          </Txt>
          <View style={{ flex: 1 }} />
          <Txt f="n7" size={12} color={colors.faint}>
            {pending ? 'Wysyłanie…' : fmtAgo(c.createdAt, now)}
          </Txt>
          {c.mine && !pending ? (
            <Pressable onPress={() => onMenu(c)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Usuń komentarz">
              <Icon name="more_horiz" size={18} color={colors.faint} />
            </Pressable>
          ) : null}
        </View>
        <Txt f="n6" size={15} color={colors.bodyDark} lh={1.4}>
          {c.text}
        </Txt>
      </View>
    </Pressable>
  );
}
