import { router, type Href } from 'expo-router';
import { View } from 'react-native';

import { Avatar, authorRingColor } from '@/components/Avatar';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { Screen } from '@/components/Screen';
import { SettingsGroup } from '@/components/Settings';
import { SkeletonRow } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { BLOCK_CONSEQUENCES, unblockNow } from '@/store/block';
import { useSimStore } from '@/store/useSimStore';
import { ui } from '@/store/useUiStore';
import { colors } from '@/theme/tokens';
import type { BlockedUser } from '@/types';
import { fmtAgo } from '@/utils/format';

/** Ustawienia → Prywatność → Zablokowani: lista z „Odblokuj”. */
export default function BlockedUsersScreen() {
  const { feed } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const list = useAsync(() => feed.getBlockedUsers(), [network]);
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/ustawienia' as Href));

  const unblock = (u: BlockedUser) =>
    ui.confirm({
      title: `Odblokować: ${u.name}?`,
      message: 'Znów zobaczycie nawzajem swoje wpisy i komentarze. Znajomość nie wróci – możesz zaprosić ponownie.',
      icon: 'lock_open',
      confirmLabel: 'Odblokuj',
      onConfirm: async () => {
        if (await unblockNow(feed, u)) list.setData((l) => l?.filter((x) => x.id !== u.id));
      },
    });

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Zablokowani
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <View style={{ backgroundColor: colors.primaryTint, borderRadius: 20, padding: 14, flexDirection: 'row', gap: 10 }}>
          <Icon name="block" size={24} color={colors.primaryText} />
          <Txt f="n7" size={13} color={colors.primaryTintBody} style={{ flex: 1 }}>
            {BLOCK_CONSEQUENCES} Zablokowani nie znajdą Cię w wyszukiwarce i nie zaproszą do znajomych. Zablokujesz kogoś
            w jego profilu, w menu „⋯” przy wpisie albo przytrzymując jego komentarz.
          </Txt>
        </View>

        {list.error ? (
          <OfflineCard onRetry={list.reload} />
        ) : !list.data ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : list.data.length === 0 ? (
          <StateCard icon="group" title="Nikogo nie blokujesz" text="Tu pojawią się osoby, które zablokujesz." />
        ) : (
          <SettingsGroup title={`Zablokowani (${list.data.length})`}>
            {list.data.map((u) => (
              <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 14 }}>
                <Avatar size={42} ringWidth={2.5} ringColor={authorRingColor(u)} avatar={u.avatar} />
                <View style={{ flex: 1 }}>
                  <Txt f="n8" size={15} numberOfLines={1}>
                    {u.name}
                  </Txt>
                  <Txt f="n6" size={12} color={colors.muted} numberOfLines={1}>
                    {[u.handle, u.blockedAt ? `zablokowano ${fmtAgo(u.blockedAt)}` : ''].filter(Boolean).join(' · ')}
                  </Txt>
                </View>
                <Pill
                  label="Odblokuj"
                  icon="lock_open"
                  iconSize={16}
                  padV={7}
                  padH={12}
                  bg="transparent"
                  color={colors.outlineText}
                  borderColor={colors.outline}
                  borderWidth={2}
                  onPress={() => unblock(u)}
                />
              </View>
            ))}
          </SettingsGroup>
        )}
      </View>
    </Screen>
  );
}
