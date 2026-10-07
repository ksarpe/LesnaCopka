import { router, useFocusEffect, useIsFocused } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';

import { Avatar, authorRingColor } from '@/components/Avatar';
import { hapticLight } from '@/components/Button3D';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { NotificationBell } from '@/components/NotificationBell';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { Placeholder } from '@/components/Placeholder';
import { PlayerSheet } from '@/components/PlayerSheet';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SkeletonCard } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { UserAvatar } from '@/components/UserAvatar';
import { useAsync } from '@/hooks/useAsync';
import { useFindPhotoSource } from '@/hooks/useFindPhotoSource';
import { useNow } from '@/hooks/useNow';
import { useServices } from '@/services';
import { confirmBlock } from '@/store/block';
import { noteSocial } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useFeedSync } from '@/store/useFeedSync';
import { useSimStore } from '@/store/useSimStore';
import { useTripStore } from '@/store/useTripStore';
import { ui, useUiStore } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, medals, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { CompactPost, LevelUpPost, Post, PostAuthor, PostScope, TripPost } from '@/types';
import { fmtAgo, fmtDurationShort, fmtInt, fmtKm, gminaTitle, plural } from '@/utils/format';
import { failText, isLocalPost, PENDING_POST_TEXT } from '@/utils/social';

/** Akcje wpisu przekazywane z ekranu do kart. */
interface PostActions {
  onReact: (p: TripPost) => void;
  onHide: (p: Post) => void;
  onReport: (p: Post) => void;
  onAuthor: (p: Post) => void;
  onBlock: (p: Post) => void;
}

/** Własny wpis „wysyłanie…” (tryb Supabase) – reakcje i komentarze dopiero po synchronizacji. */
const pendingToast = () => ui.toast(PENDING_POST_TEXT, 'sync');

export default function FeedScreen() {
  const { feed } = useServices();
  const [scope, setScope] = useState<PostScope>('friends');
  const network = useSimStore((s) => s.networkEnabled);
  const forced = useSimStore((s) => s.forcedGminaId);
  const posts = useAsync(() => feed.getFeed(scope), [scope, network, forced]);
  const hidden = useAsync(() => feed.getHiddenPosts(), [network]);
  const { setData: setPosts } = posts;
  const { setData: setHidden, reload: reloadHidden } = hidden;
  const [refreshing, setRefreshing] = useState(false);
  /** Wpisy ukryte przed chwilą – zamiast nich karta „Wpis ukryty · Cofnij” (do odświeżenia listy). */
  const [justHidden, setJustHidden] = useState<string[]>([]);
  const [profileOf, setProfileOf] = useState<PostAuthor | null>(null);

  const scopeRef = useRef(scope);
  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  /** Ponowne pobranie bez szkieletów (po zmianie znajomych / ukrytych); błąd sieci zostawia starą listę. */
  const silentRefresh = useCallback(async () => {
    const s = scopeRef.current;
    reloadHidden();
    try {
      const next = await feed.getFeed(s);
      if (s !== scopeRef.current) return;
      setPosts(() => next);
      setJustHidden([]);
    } catch {
      // offline – zostaje to, co widać
    }
  }, [feed, setPosts, reloadHidden]);

  // Powrót z Komentarzy / Znajomych: od razu nowe liczniki komentarzy, a przy zmianie znajomych – nowa lista.
  const applySync = useCallback(() => {
    const { commentCounts, stale } = useFeedSync.getState().take();
    if (Object.keys(commentCounts).length) {
      setPosts((list) =>
        list?.map((p) => (p.kind === 'trip' && commentCounts[p.id] != null ? { ...p, comments: commentCounts[p.id] } : p)),
      );
    }
    if (stale) void silentRefresh();
  }, [setPosts, silentRefresh]);
  useFocusEffect(applySync);
  // Zmiana w tle przy otwartym feedzie (np. publikacja właśnie dotarła na serwer) – od razu.
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return;
    return useFeedSync.subscribe((s, prev) => {
      if (s.stale && !prev.stale) applySync();
    });
  }, [focused, applySync]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const next = await feed.loadNewer(scope);
      posts.setData(() => next);
      setJustHidden([]);
    } catch {
      ui.toast('Brak sieci – nie udało się odświeżyć', 'wifi_off');
    } finally {
      setRefreshing(false);
    }
  };

  const onReact = async (p: TripPost) => {
    if (isLocalPost(p.id)) return pendingToast();
    hapticLight();
    const optimistic = { reacted: !p.reacted, reactions: p.reactions + (p.reacted ? -1 : 1) };
    posts.setData((list) => list?.map((x) => (x.id === p.id ? { ...x, ...optimistic } : x)));
    try {
      // Liczba z serwera (w międzyczasie mogli zareagować inni).
      const r = await feed.toggleReaction(p.id);
      posts.setData((list) => list?.map((x) => (x.id === p.id && x.kind === 'trip' ? { ...x, ...r } : x)));
      // Osiągnięcie „Darz grzyb!” i zadanie „Daj Darz grzyb! N wyprawom” (tylko cudze wpisy – jak serwer).
      if (!p.mine && r.reacted !== p.reacted) noteSocial(r.reacted ? 'reactionGiven' : 'reactionRemoved');
    } catch (e) {
      posts.setData((list) => list?.map((x) => (x.id === p.id ? p : x)));
      ui.toast(failText(e, 'Brak sieci – reakcja nie została zapisana'), 'wifi_off');
    }
  };

  const onHide = async (p: Post) => {
    setJustHidden((ids) => [...ids, p.id]);
    setHidden((list) => [p, ...(list ?? [])]);
    try {
      await feed.hidePost(p.id);
      ui.toast('Wpis ukryty', 'visibility_off');
    } catch (e) {
      setJustHidden((ids) => ids.filter((x) => x !== p.id));
      setHidden((list) => list?.filter((x) => x.id !== p.id));
      ui.toast(failText(e, 'Brak sieci – nie udało się ukryć wpisu'), 'wifi_off');
    }
  };

  const onReport = async (p: Post) => {
    // Toast od razu (jak dotąd) – zgłoszenie idzie w tle; przy braku sieci mówimy, że nie dotarło.
    ui.toast('Dziękujemy – zgłoszenie wysłane', 'flag');
    try {
      await feed.reportPost(p.id);
    } catch (e) {
      ui.toast(failText(e, 'Brak sieci – zgłoszenie nie zostało wysłane'), 'wifi_off');
    }
  };

  const onUndoHide = async (p: Post) => {
    setJustHidden((ids) => ids.filter((x) => x !== p.id));
    setHidden((list) => list?.filter((x) => x.id !== p.id));
    try {
      await feed.unhidePosts([p.id]);
    } catch {
      setJustHidden((ids) => [...ids, p.id]);
      setHidden((list) => [p, ...(list ?? [])]);
      ui.toast('Brak sieci – wpis nadal jest ukryty', 'wifi_off');
    }
  };

  const hiddenCount = hidden.data?.length ?? 0;
  const onRestoreHidden = () =>
    ui.confirm({
      title: 'Przywrócić ukryte wpisy?',
      message: `${hiddenCount} ${plural(hiddenCount, 'wpis wróci', 'wpisy wrócą', 'wpisów wróci')} do feedu.`,
      icon: 'visibility',
      confirmLabel: 'Przywróć',
      onConfirm: async () => {
        try {
          await feed.unhidePosts();
          setHidden(() => []);
          await silentRefresh();
          ui.toast('Ukryte wpisy wróciły do feedu', 'visibility');
        } catch {
          ui.toast('Brak sieci – spróbuj ponownie', 'wifi_off');
        }
      },
    });

  const onAuthor = (p: Post) => {
    // Własny wpis (także awans z serwera) → profil gracza zamiast mini profilu.
    if ((p.kind === 'trip' && p.mine) || p.author.id === useUserStore.getState().user.id) router.navigate('/profil');
    else setProfileOf(p.author);
  };

  /** Zablokowany: jego wpisy znikają od razu (serwer też ich już nie zwróci). */
  const dropAuthor = (authorId: string) => posts.setData((list) => list?.filter((x) => x.author.id !== authorId));
  const onBlock = (p: Post) => confirmBlock(feed, p.author, () => dropAuthor(p.author.id));

  const actions: PostActions = { onReact, onHide, onReport, onAuthor, onBlock };

  return (
    <Screen
      tabs
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primaryText} colors={[colors.primary]} />}
    >
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt f="b7" size={30}>
            Feed
          </Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <NotificationBell />
            <IconButton icon="person_add" iconSize={22} onPress={openFriends} accessibilityLabel="Znajomi" />
          </View>
        </View>
        <SegmentedControl
          value={scope}
          onChange={setScope}
          options={[
            { value: 'friends', label: 'Znajomi' },
            { value: 'gmina', label: 'Moja gmina' },
          ]}
        />

        {posts.error ? (
          <OfflineCard onRetry={posts.reload} />
        ) : posts.loading && !posts.data ? (
          <>
            <SkeletonCard media={190} lines={2} radius={26} />
            <SkeletonCard lines={1} radius={22} />
          </>
        ) : posts.data && posts.data.length === 0 ? (
          <StateCard
            icon="forest"
            title="Cisza w lesie"
            text={scope === 'gmina' ? 'Nikt z Twojej gminy nie opublikował jeszcze wyprawy.' : 'Dodaj znajomych, żeby widzieć ich wyprawy.'}
            action={scope === 'gmina' ? 'Odśwież' : 'Dodaj znajomych'}
            onAction={scope === 'gmina' ? onRefresh : openFriends}
          />
        ) : (
          <View style={{ gap: 16, paddingBottom: 8 }}>
            {posts.data?.map((p) =>
              justHidden.includes(p.id) ? (
                <HiddenStub key={p.id} post={p} onUndo={() => onUndoHide(p)} />
              ) : (
                <PostView key={p.id} post={p} actions={actions} />
              ),
            )}
          </View>
        )}

        {!posts.error && posts.data && hiddenCount > 0 ? (
          <Pressable
            onPress={onRestoreHidden}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'center',
              gap: 6,
              paddingVertical: 6,
              paddingHorizontal: 12,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="visibility_off" size={16} color={colors.faint} />
            <Txt f="n8" size={13} color={colors.muted}>
              Ukryte wpisy ({hiddenCount}) · Przywróć
            </Txt>
          </Pressable>
        ) : null}
      </View>
      <PlayerSheet
        author={profileOf}
        onClose={() => setProfileOf(null)}
        onFriendChange={() => void silentRefresh()}
        onBlockChange={(a, blocked) => (blocked ? dropAuthor(a.id) : void silentRefresh())}
      />
    </Screen>
  );
}

function openFriends() {
  router.push('/znajomi');
}

function PostView({ post, actions }: { post: Post; actions: PostActions }) {
  if (post.kind === 'levelup') return <LevelUpView post={post} onAuthor={actions.onAuthor} />;
  if (post.kind === 'compact') return <CompactView post={post} onAuthor={actions.onAuthor} />;
  return <TripView post={post} actions={actions} />;
}

/** Karta w miejscu ukrytego wpisu – „Cofnij” przywraca go od razu. */
function HiddenStub({ post, onUndo }: { post: Post; onUndo: () => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 22,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: colors.dimDash,
        backgroundColor: colors.dimTile,
        paddingVertical: 12,
        paddingHorizontal: 14,
      }}
    >
      <Icon name="visibility_off" size={22} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={14}>
          Wpis ukryty
        </Txt>
        <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
          {post.author.name} · nie zobaczysz go w feedzie
        </Txt>
      </View>
      <Pill label="Cofnij" icon="undo" iconSize={17} padV={7} padH={12} onPress={onUndo} />
    </View>
  );
}

function PostHeader({
  post,
  more,
  onHide,
  onReport,
  onBlock,
  onAuthor,
}: {
  post: Post;
  more?: boolean;
  onHide?: (p: Post) => void;
  onReport?: (p: Post) => void;
  onBlock?: (p: Post) => void;
  onAuthor: (p: Post) => void;
}) {
  const gmina = useCatalogStore((s) => s.gminaById[post.gminaId]);
  const now = useNow(60_000);
  const mine = post.kind === 'trip' && post.mine;
  const hidden = mine && new Date(post.visibleFrom).getTime() > now;
  const ring = authorRingColor(post.author);
  // Wpis czekający na serwer (tryb Supabase) – „wysyłanie…” zamiast „widoczne za 24 h”.
  const when = hidden ? (isLocalPost(post.id) ? 'wysyłanie…' : 'widoczne za 24 h') : fmtAgo(post.createdAt, now);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable
        onPress={() => onAuthor(post)}
        accessibilityRole="button"
        accessibilityLabel={mine ? 'Twój profil' : `Profil: ${post.author.name}`}
        style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.75 : 1 })}
      >
        {mine ? <UserAvatar size={42} ringColor={ring} /> : <Avatar size={42} ringColor={ring} avatar={post.author.avatar} />}
        <View style={{ flex: 1 }}>
          <Txt f="n8" size={15} numberOfLines={1}>
            {mine ? 'Ty' : post.author.name}{' '}
            <Txt f="n7" size={15} color={colors.muted}>
              · Lv {post.author.level}
            </Txt>
          </Txt>
          <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
            {gminaTitle(gmina)} · {when}
          </Txt>
        </View>
      </Pressable>
      {more ? (
        <Pressable onPress={() => postMenu(post, onHide, onReport, onBlock)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Więcej">
          <Icon name="more_horiz" size={22} color={colors.faint} />
        </Pressable>
      ) : null}
    </View>
  );
}

function postMenu(post: Post, onHide?: (p: Post) => void, onReport?: (p: Post) => void, onBlock?: (p: Post) => void) {
  useUiStore.getState().showDialog({
    title: post.author.name,
    actions: [
      { label: 'Ukryj wpis', style: 'default', onPress: () => onHide?.(post) },
      { label: 'Zgłoś', style: 'danger', onPress: () => onReport?.(post) },
      // Wpis „wysyłanie…” i własne nie mają menu; tu zawsze cudzy autor.
      ...(onBlock ? [{ label: `Zablokuj: ${post.author.name}`, style: 'danger' as const, onPress: () => onBlock(post) }] : []),
      { label: 'Anuluj', style: 'cancel' },
    ],
  });
}

function TripView({ post, actions }: { post: TripPost; actions: PostActions }) {
  const hl = post.highlight;
  const hlColor = hl ? rarityTokens[hl.rarity].color : undefined;
  // Okładka: własny wpis – zdjęcie znaleziska z telefonu, a gdy go nie ma (nowe urządzenie) i cudze wpisy – okładka
  // z serwera (publiczny adres w `post-media`, tryb Supabase). Bez zdjęcia – paski z makiety.
  const local = useTripStore((s) => (post.coverFindId ? s.finds[post.coverFindId]?.photoUri : undefined));
  const localSource = useFindPhotoSource(local);
  const remoteSource = useMemo(() => (post.coverUrl ? { uri: post.coverUrl } : undefined), [post.coverUrl]);
  const cover = localSource ?? remoteSource;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 26, padding: 14, gap: 12, boxShadow: shadows.card }}>
      <PostHeader
        post={post}
        more={!post.mine}
        onHide={actions.onHide}
        onReport={actions.onReport}
        onBlock={actions.onBlock}
        onAuthor={actions.onAuthor}
      />
      <Txt f="b7" size={20} lh={1.15}>
        {post.title}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <PostStat label="Dystans" value={fmtKm(post.distanceKm)} />
        <PostStat label="Czas" value={fmtDurationShort(post.durationMin)} />
        <PostStat label="Grzyby" value={String(post.mushrooms)} />
        <PostStat label="XP" value={`+${fmtInt(post.xp)}`} accent />
      </View>
      <Placeholder
        variant="sand"
        stripe={10}
        label="zdjęcie znaleziska"
        source={cover}
        style={{ height: 190, borderRadius: 18 }}
      >
        {hl ? (
          <Pill
            label={`${rarityTokens[hl.rarity].label} · ${hl.text}`}
            icon="diamond"
            iconFilled
            iconSize={15}
            size={12}
            padV={6}
            padH={11}
            gap={6}
            bg={hlColor}
            color={hl.rarity === 'legendarny' ? colors.legendBadgeInk : colors.rarityInk}
            shadow={shadows.pill}
            style={{ position: 'absolute', left: 10, bottom: 10 }}
          />
        ) : null}
        {post.mine ? (
          <Pill
            label={post.routePrecision === 'gmina' ? 'Trasa ukryta' : 'Trasa przybliżona'}
            icon={post.routePrecision === 'gmina' ? 'visibility_off' : 'route'}
            size={12}
            bg="rgba(255,255,255,0.92)"
            color={colors.ink}
            style={{ position: 'absolute', right: 10, top: 10 }}
          />
        ) : null}
      </Placeholder>
      {post.mine ? (
        <View
          style={{
            flexDirection: 'row',
            gap: 8,
            alignItems: 'center',
            backgroundColor: colors.primaryTint,
            borderRadius: 14,
            paddingVertical: 8,
            paddingHorizontal: 10,
          }}
        >
          <Icon name="schedule" size={16} color={colors.primaryText} />
          <Txt f="n7" size={12} color={colors.primaryTintBody} style={{ flex: 1 }}>
            Widoczne dla innych za 24 h · bez dokładnej lokalizacji
          </Txt>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pill
          label={`Darz grzyb! ${post.reactions}`}
          icon="forest"
          iconFilled
          iconSize={17}
          padV={7}
          padH={12}
          bg={post.reacted ? colors.primary : colors.primaryTint}
          color={post.reacted ? colors.primaryInk : colors.primaryTintText}
          onPress={() => actions.onReact(post)}
        />
        <Pressable
          onPress={() =>
            isLocalPost(post.id) ? pendingToast() : router.push({ pathname: '/komentarze/[postId]', params: { postId: post.id } })
          }
          accessibilityRole="button"
          accessibilityLabel={`Komentarze: ${post.comments}`}
          hitSlop={4}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            paddingVertical: 7,
            paddingHorizontal: 6,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Icon name="chat_bubble" size={17} color={colors.muted} />
          <Txt f="n8" size={13} color={colors.muted}>
            {post.comments}
          </Txt>
        </Pressable>
        <View style={{ flex: 1 }} />
        {!post.mine ? (
          <Pill
            label="Spróbuj też"
            icon="flag"
            iconSize={17}
            gap={4}
            padV={6}
            padH={12}
            bg="transparent"
            color={colors.primaryTintText}
            borderColor={colors.primary}
            borderWidth={2}
            onPress={() => router.push(`/gminy/${post.gminaId}`)}
          />
        ) : null}
      </View>
    </View>
  );
}

function PostStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View>
      <Txt f="n8" size={11} color={colors.muted}>
        {label}
      </Txt>
      <Txt f="b7" size={17} color={accent ? colors.primaryText : colors.ink}>
        {value}
      </Txt>
    </View>
  );
}

function LevelUpView({ post, onAuthor }: { post: LevelUpPost; onAuthor: (p: Post) => void }) {
  const now = useNow(60_000);
  return (
    <View
      style={{
        backgroundColor: colors.forest,
        borderRadius: 22,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        boxShadow: shadows.forest,
      }}
    >
      <Pressable onPress={() => onAuthor(post)} accessibilityRole="button" accessibilityLabel={`Profil: ${post.author.name}`} hitSlop={4}>
        <Avatar size={46} variant="forestAvatar" ringColor={colors.primary} avatar={post.author.avatar} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={14} color={colors.onDark}>
          {post.author.name} awansował na Lv {post.level}!
        </Txt>
        <Txt f="n7" size={12} color={colors.onDark} style={{ opacity: 0.85 }}>
          {post.badgeName ? `+ odznaka „${post.badgeName}” · ` : ''}
          {fmtAgo(post.createdAt, now)}
        </Txt>
      </View>
      <Icon name="celebration" filled size={28} color={medals[0]} />
    </View>
  );
}

function CompactView({ post, onAuthor }: { post: CompactPost; onAuthor: (p: Post) => void }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 26, padding: 14, gap: 12, boxShadow: shadows.card }}>
      <PostHeader post={post} onAuthor={onAuthor} />
      <Txt f="n7" size={14} color={colors.bodyDark}>
        {fmtKm(post.distanceKm)} · {post.mushrooms} {plural(post.mushrooms, 'grzyb', 'grzyby', 'grzybów')} · {post.species}{' '}
        {plural(post.species, 'gatunek', 'gatunki', 'gatunków')} · +{fmtInt(post.xp)} XP
      </Txt>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {post.thumbs.map((r, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              borderRadius: 14,
              overflow: 'hidden',
              borderBottomWidth: 4,
              borderBottomColor: rarityTokens[r].color,
            }}
          >
            <Placeholder variant="sand" stripe={6} style={{ aspectRatio: 1 }} />
          </View>
        ))}
      </View>
    </View>
  );
}
