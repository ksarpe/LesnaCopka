import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { hapticLight } from '@/components/Button3D';
import { IconButton } from '@/components/IconButton';
import { OfflineCard, StateCard } from '@/components/OfflineCard';
import { PlayerCard } from '@/components/PlayerSheet';
import { Screen } from '@/components/Screen';
import { SkeletonCard } from '@/components/Skeleton';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { friendActionFailed, runFriendAction } from '@/store/friends';
import { useSimStore } from '@/store/useSimStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, shadows } from '@/theme/tokens';
import type { FriendStatus } from '@/types';
import { withFriendStatus, type FriendAction } from '@/utils/friends';
import { handleFromInvite } from '@/utils/social';

/**
 * Link zaproszenia (`https://grzybobranie.app/zaproszenie/<nick>`, w aplikacji także
 * `grzybobranie://zaproszenie/<nick>`): karta zapraszającego grzybiarza z przyciskiem relacji
 * („Dodaj do znajomych”, „Akceptuj”…). Własny link – podpowiedź, żeby go wysłać dalej.
 */
export default function InviteScreen() {
  const { handle = '' } = useLocalSearchParams<{ handle: string }>();
  const { feed } = useServices();
  const network = useSimStore((s) => s.networkEnabled);
  const me = useUserStore((s) => s.user.handle);
  const nick = handleFromInvite(String(handle));
  const own = !!nick && nick === handleFromInvite(me);
  const res = useAsync(() => (own || !nick ? Promise.resolve(null) : feed.getUserByHandle(nick)), [nick, own, network]);
  const [status, setStatus] = useState<FriendStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const user = res.data ? (status ? withFriendStatus(res.data, status) : res.data) : undefined;

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/feed'));
  const toFriends = () => router.replace('/znajomi');

  const act = async (action: FriendAction) => {
    if (!user || busy) return;
    setBusy(true);
    hapticLight();
    try {
      setStatus(await runFriendAction(feed, user, action));
    } catch (e) {
      friendActionFailed(action, e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Zaproszenie
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        {own ? (
          <StateCard
            icon="link"
            title="To Twój link zaproszenia"
            text="Wyślij go znajomym – po otwarciu zobaczą Twój profil i dodadzą Cię do znajomych."
            action="Przejdź do znajomych"
            onAction={toFriends}
          />
        ) : res.error ? (
          <OfflineCard onRetry={res.reload} />
        ) : res.loading && !res.data ? (
          <SkeletonCard lines={3} radius={28} />
        ) : !user ? (
          <StateCard
            icon="search"
            title="Nie znaleziono grzybiarza"
            text={nick ? `Nikt nie używa nicku @${nick}. Sprawdź link albo wyszukaj znajomego po nicku.` : 'Link zaproszenia jest niepełny.'}
            action="Szukaj znajomych"
            onAction={toFriends}
          />
        ) : (
          <>
            <View style={{ gap: 4 }}>
              <Txt f="b7" size={26} lh={1.15}>
                {user.name} zaprasza Cię do Grzybobrania!
              </Txt>
              <Txt f="n7" size={14} color={colors.muted}>
                Dodajcie się do znajomych, żeby widzieć nawzajem swoje wyprawy w feedzie.
              </Txt>
            </View>
            <PlayerCard
              author={user}
              user={user}
              onAction={(a) => void act(a)}
              busy={busy}
              style={{ maxWidth: undefined, backgroundColor: colors.card, boxShadow: shadows.card }}
              footer={
                <Pressable onPress={toFriends} hitSlop={6} style={({ pressed }) => ({ paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
                  <Txt f="b7" size={16} color={colors.outlineText} align="center">
                    Przejdź do znajomych
                  </Txt>
                </Pressable>
              }
            />
          </>
        )}
      </View>
    </Screen>
  );
}
