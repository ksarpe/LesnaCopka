import type { ReactNode } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAsync } from '@/hooks/useAsync';
import { ServiceError, useServices } from '@/services';
import { confirmBlock, unblockNow } from '@/store/block';
import { friendActionFailed, runFriendAction } from '@/store/friends';
import { useCatalogStore } from '@/store/useCatalogStore';
import { colors, shadows } from '@/theme/tokens';
import type { FriendStatus, PostAuthor, SocialUser } from '@/types';
import { fmtInt, gminaTitle, plural } from '@/utils/format';
import { withFriendStatus, type FriendAction } from '@/utils/friends';
import { levelTitle } from '@/utils/xp';
import { Avatar, authorRingColor } from './Avatar';
import { Button3D } from './Button3D';
import { Icon, type IconName } from './Icon';
import { Pill } from './Pill';
import { Bone } from './Skeleton';
import { Txt } from './Txt';

interface PlayerSheetProps {
  /** Autor wpisu / komentarza; null = zamknięte. */
  author: PostAuthor | null;
  onClose: () => void;
  /** Po zapisaniu zmiany znajomości (feed odświeża zakres „Znajomi”). */
  onFriendChange?: (user: SocialUser) => void;
  /** Po zablokowaniu / odblokowaniu (ekran usuwa wpisy / komentarze zablokowanego). */
  onBlockChange?: (author: PostAuthor, blocked: boolean) => void;
}

/**
 * Mini profil grzybiarza (tapnięcie avatara / nicku w feedzie i komentarzach): poziom, gmina,
 * liczba wypraw i przycisk relacji zależny od statusu („Dodaj do znajomych”, „Anuluj zaproszenie”,
 * „Akceptuj” / „Odrzuć”, „Usuń ze znajomych”), a na dole „Zablokuj” / „Odblokuj”. Dane z FeedService.getUser.
 */
export function PlayerSheet({ author, onClose, onFriendChange, onBlockChange }: PlayerSheetProps) {
  if (!author) return null;
  return (
    <Modal transparent animationType="fade" visible statusBarTranslucent onRequestClose={onClose}>
      <SheetBody key={author.id} author={author} onClose={onClose} onFriendChange={onFriendChange} onBlockChange={onBlockChange} />
    </Modal>
  );
}

/** iOS nie pokaże dialogu, dopóki modal mini profilu nie zniknie do końca. */
const AFTER_MODAL_MS = Platform.OS === 'ios' ? 400 : 0;

function SheetBody({ author, onClose, onFriendChange, onBlockChange }: PlayerSheetProps & { author: PostAuthor }) {
  const { feed } = useServices();
  const profile = useAsync(() => feed.getUser(author.id), [author.id]);

  const block = () => {
    onClose();
    setTimeout(() => confirmBlock(feed, author, () => onBlockChange?.(author, true)), AFTER_MODAL_MS);
  };
  const unblock = async () => {
    onClose();
    if (await unblockNow(feed, author)) onBlockChange?.(author, false);
  };

  const act = async (action: FriendAction) => {
    const u = profile.data;
    if (!u) return;
    onClose();
    try {
      const status = await runFriendAction(feed, u, action);
      onFriendChange?.(withFriendStatus(u, status));
    } catch (e) {
      friendActionFailed(action, e);
    }
  };

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij profil" />
      <PlayerCard
        author={author}
        user={profile.data}
        error={!!profile.error}
        notFound={profile.error instanceof ServiceError && profile.error.code === 'NOT_FOUND'}
        onRetry={profile.reload}
        onAction={act}
        onBlock={block}
        onUnblock={() => void unblock()}
        footer={
          <Pressable onPress={onClose} hitSlop={6} style={({ pressed }) => ({ paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
            <Txt f="b7" size={16} color={colors.outlineText} align="center">
              Zamknij
            </Txt>
          </Pressable>
        }
      />
    </View>
  );
}

const BLOCKED_CHIP = { icon: 'block' as IconName, label: 'Zablokowany' };

const STATUS_CHIP: Partial<Record<FriendStatus, { icon: IconName; label: string }>> = {
  friends: { icon: 'group', label: 'Znajomy' },
  incoming: { icon: 'mail', label: 'Zaprasza Cię' },
  outgoing: { icon: 'send', label: 'Zaproszenie wysłane' },
};

interface PlayerCardProps {
  /** Co wiemy od razu (z wpisu / komentarza) – reszta po wczytaniu profilu. */
  author: PostAuthor;
  user?: SocialUser;
  error?: boolean;
  /** Profil niedostępny (usunięty albo ten grzybiarz zablokował gracza) – bez „Spróbuj ponownie”. */
  notFound?: boolean;
  onRetry?: () => void;
  onAction: (action: FriendAction) => void;
  /** „Zablokuj” pod przyciskami (brak = bez blokowania, np. strona zaproszenia). */
  onBlock?: () => void;
  onUnblock?: () => void;
  /** Przycisk akcji nieaktywny (trwa zapis). */
  busy?: boolean;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Karta grzybiarza (mini profil, strona zaproszenia): avatar, nick, chipy i przyciski relacji. */
export function PlayerCard({ author, user: u, error, notFound, onRetry, onAction, onBlock, onUnblock, busy, footer, style }: PlayerCardProps) {
  const gmina = useCatalogStore((s) => (u?.homeGminaId ? s.gminaById[u.homeGminaId] : undefined));
  const chip = u ? (u.blocked ? BLOCKED_CHIP : STATUS_CHIP[u.friendStatus]) : undefined;
  const subtitle = u ? [u.handle, u.fullName].filter(Boolean).join(' · ') : '';
  return (
    <View style={[styles.card, style]}>
      <Avatar size={76} ringWidth={4} ringColor={authorRingColor(author)} avatar={author.avatar ?? u?.avatar} />
      <View style={{ alignItems: 'center' }}>
        <Txt f="b7" size={22} align="center" lh={1.15}>
          {author.name}
        </Txt>
        {u ? (
          subtitle ? (
            <Txt f="n7" size={13} color={colors.muted} align="center">
              {subtitle}
            </Txt>
          ) : null
        ) : error ? null : (
          <Bone w={150} h={12} style={{ marginTop: 5 }} />
        )}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 4 }}>
        <Pill label={`Lv ${author.level} · ${levelTitle(author.level)}`} icon="military_tech" iconFilled size={12} />
        {u ? (
          <>
            <Chip icon="location_on" label={gminaTitle(gmina) || 'Gmina nieznana'} />
            <Chip icon="hiking" label={`${fmtInt(u.tripsCount)} ${plural(u.tripsCount, 'wyprawa', 'wyprawy', 'wypraw')}`} />
            {u.speciesCount != null ? (
              <Chip icon="eco" label={`${fmtInt(u.speciesCount)} ${plural(u.speciesCount, 'gatunek', 'gatunki', 'gatunków')}`} />
            ) : null}
            {chip ? <Chip icon={chip.icon} label={chip.label} /> : null}
          </>
        ) : error ? null : (
          <>
            <Bone w={110} h={26} r={13} />
            <Bone w={84} h={26} r={13} />
          </>
        )}
      </View>

      {error ? (
        <Txt f="n6" size={14} color={colors.muted} align="center">
          {notFound ? 'Ten profil jest niedostępny.' : 'Brak połączenia – nie udało się wczytać profilu.'}
        </Txt>
      ) : null}

      <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 8 }}>
        {u ? (
          u.blocked ? (
            <>
              <Txt f="n6" size={13} color={colors.muted} align="center">
                Zablokowany – nie widzicie nawzajem swoich wpisów i komentarzy.
              </Txt>
              {onUnblock ? <OutlineButton icon="lock_open" label="Odblokuj" onPress={onUnblock} /> : null}
            </>
          ) : (
            <FriendButtons status={u.friendStatus} onAction={onAction} busy={busy} />
          )
        ) : error ? (
          onRetry && !notFound ? <OutlineButton icon="refresh" label="Spróbuj ponownie" onPress={onRetry} /> : null
        ) : (
          <Bone w="100%" h={54} r={18} />
        )}
        {footer}
        {u && !u.blocked && onBlock ? (
          <Pressable
            onPress={onBlock}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 4,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon name="block" size={16} color={colors.danger} />
            <Txt f="n8" size={13} color={colors.danger}>
              Zablokuj
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Przyciski relacji z grzybiarzem – zależne od statusu (zaproszenia w obie strony). */
function FriendButtons({ status, onAction, busy }: { status: FriendStatus; onAction: (a: FriendAction) => void; busy?: boolean }) {
  const run = (a: FriendAction) => () => {
    if (!busy) onAction(a);
  };
  switch (status) {
    case 'friends':
      return <OutlineButton icon="person_remove" label="Usuń ze znajomych" onPress={run('remove')} />;
    case 'outgoing':
      return <OutlineButton icon="undo" label="Anuluj zaproszenie" onPress={run('cancel')} />;
    case 'incoming':
      return (
        <>
          <Button3D title="Akceptuj zaproszenie" icon="group_add" size="md" onPress={run('accept')} disabled={busy} />
          <OutlineButton icon="close" label="Odrzuć" onPress={run('reject')} />
        </>
      );
    default:
      return <Button3D title="Dodaj do znajomych" icon="person_add" size="md" onPress={run('request')} disabled={busy} />;
  }
}

function Chip({ icon, label }: { icon: IconName; label: string }) {
  return <Pill label={label} icon={icon} size={12} bg={colors.chip} color={colors.tagNeutralText} />;
}

/** Obrysowany przycisk jak w dialogach („Anuluj”, akcje drugorzędne). */
export function OutlineButton({ icon, label, onPress }: { icon?: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.outline, pressed && { backgroundColor: colors.outlineHover }]}
    >
      {icon ? <Icon name={icon} size={20} color={colors.outlineText} /> : null}
      <Txt f="b7" size={17} color={colors.outlineText} align="center">
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(30,27,22,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.bg,
    borderRadius: 28,
    padding: 22,
    alignItems: 'center',
    gap: 8,
    boxShadow: shadows.dialog,
  },
  outline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2.5,
    borderColor: colors.outline,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
});
