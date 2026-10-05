import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';

import { Avatar, authorRingColor } from '@/components/Avatar';
import { hapticLight } from '@/components/Button3D';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { Placeholder } from '@/components/Placeholder';
import { Screen } from '@/components/Screen';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SkeletonCard } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useNow } from '@/hooks/useNow';
import { useServices } from '@/services';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { ui, useUiStore } from '@/store/useUiStore';
import { colors, medals, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { CompactPost, LevelUpPost, Post, PostScope, TripPost } from '@/types';
import { fmtAgo, fmtDurationShort, fmtInt, fmtKm, gminaTitle, plural } from '@/utils/format';

export default function FeedScreen() {
  const { feed } = useServices();
  const [scope, setScope] = useState<PostScope>('friends');
  const network = useSimStore((s) => s.networkEnabled);
  const forced = useSimStore((s) => s.forcedGminaId);
  const posts = useAsync(() => feed.getFeed(scope), [scope, network, forced]);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const next = await feed.loadNewer(scope);
      posts.setData(() => next);
    } catch {
      ui.toast('Brak sieci – nie udało się odświeżyć', 'wifi_off');
    } finally {
      setRefreshing(false);
    }
  };

  const onReact = async (p: TripPost) => {
    hapticLight();
    const optimistic = { reacted: !p.reacted, reactions: p.reactions + (p.reacted ? -1 : 1) };
    posts.setData((list) => list?.map((x) => (x.id === p.id ? { ...x, ...optimistic } : x)));
    try {
      await feed.toggleReaction(p.id);
    } catch {
      posts.setData((list) => list?.map((x) => (x.id === p.id ? p : x)));
      ui.toast('Brak sieci – reakcja nie została zapisana', 'wifi_off');
    }
  };

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
          <IconButton icon="person_add" iconSize={22} onPress={addFriend} accessibilityLabel="Dodaj znajomego" />
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
            onAction={scope === 'gmina' ? onRefresh : addFriend}
          />
        ) : (
          <View style={{ gap: 16, paddingBottom: 8 }}>
            {posts.data?.map((p) => <PostView key={p.id} post={p} onReact={onReact} />)}
          </View>
        )}
      </View>
    </Screen>
  );
}

function addFriend() {
  useUiStore.getState().showDialog({
    title: 'Dodaj znajomego',
    icon: 'person_add',
    message: 'Zaproś znajomych po nicku albo linkiem. W prototypie lista znajomych jest stała.',
    actions: [
      { label: 'Udostępnij link', style: 'primary', onPress: () => ui.soon('Zaproszenia') },
      { label: 'Zamknij', style: 'cancel' },
    ],
  });
}

function PostView({ post, onReact }: { post: Post; onReact: (p: TripPost) => void }) {
  if (post.kind === 'levelup') return <LevelUpView post={post} />;
  if (post.kind === 'compact') return <CompactView post={post} />;
  return <TripView post={post} onReact={onReact} />;
}

function PostHeader({ post, more }: { post: Post; more?: boolean }) {
  const gmina = useCatalogStore((s) => s.gminaById[post.gminaId]);
  const now = useNow(60_000);
  const mine = post.kind === 'trip' && post.mine;
  const hidden = mine && new Date(post.visibleFrom).getTime() > now;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Avatar size={42} ringColor={authorRingColor(post.author)} />
      <View style={{ flex: 1 }}>
        <Txt f="n8" size={15} numberOfLines={1}>
          {mine ? 'Ty' : post.author.name}{' '}
          <Txt f="n7" size={15} color={colors.muted}>
            · Lv {post.author.level}
          </Txt>
        </Txt>
        <Txt f="n7" size={12} color={colors.muted} numberOfLines={1}>
          {gminaTitle(gmina)} · {hidden ? 'widoczne za 24 h' : fmtAgo(post.createdAt, now)}
        </Txt>
      </View>
      {more ? (
        <Pressable onPress={() => postMenu(post)} hitSlop={10}>
          <Icon name="more_horiz" size={22} color={colors.faint} />
        </Pressable>
      ) : null}
    </View>
  );
}

function postMenu(post: Post) {
  useUiStore.getState().showDialog({
    title: post.author.name,
    actions: [
      { label: 'Ukryj wpis', style: 'default', onPress: () => ui.soon('Ukrywanie wpisów') },
      { label: 'Zgłoś', style: 'danger', onPress: () => ui.toast('Dziękujemy – zgłoszenie wysłane', 'flag') },
      { label: 'Anuluj', style: 'cancel' },
    ],
  });
}

function TripView({ post, onReact }: { post: TripPost; onReact: (p: TripPost) => void }) {
  const hl = post.highlight;
  const hlColor = hl ? rarityTokens[hl.rarity].color : undefined;
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 26, padding: 14, gap: 12, boxShadow: shadows.card }}>
      <PostHeader post={post} more={!post.mine} />
      <Txt f="b7" size={20} lh={1.15}>
        {post.title}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 14 }}>
        <PostStat label="Dystans" value={fmtKm(post.distanceKm)} />
        <PostStat label="Czas" value={fmtDurationShort(post.durationMin)} />
        <PostStat label="Grzyby" value={String(post.mushrooms)} />
        <PostStat label="XP" value={`+${fmtInt(post.xp)}`} accent />
      </View>
      <Placeholder variant="sand" stripe={10} label="zdjęcie znaleziska" style={{ height: 190, borderRadius: 18 }}>
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
          onPress={() => onReact(post)}
        />
        <Pressable
          onPress={() => ui.soon('Komentarze')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 6 }}
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

function LevelUpView({ post }: { post: LevelUpPost }) {
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
      <Avatar size={46} variant="forestAvatar" ringColor={colors.primary} />
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

function CompactView({ post }: { post: CompactPost }) {
  return (
    <View style={{ backgroundColor: colors.card, borderRadius: 26, padding: 14, gap: 12, boxShadow: shadows.card }}>
      <PostHeader post={post} />
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
