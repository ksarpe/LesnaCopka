import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Button3D } from '@/components/Button3D';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { OfflineCard } from '@/components/OfflineCard';
import { Pill } from '@/components/Pill';
import { Placeholder } from '@/components/Placeholder';
import { Screen } from '@/components/Screen';
import { Bone, SkeletonCard, SkeletonRow } from '@/components/Skeleton';
import { Sheet } from '@/components/SpeciesSheet';
import { StatTile } from '@/components/StatTile';
import { Thumb } from '@/components/Thumb';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useTopInset } from '@/hooks/useInsets';
import { useServices } from '@/services';
import { acceptChallenge, toggleFollow } from '@/store/game';
import { useCatalogStore } from '@/store/useCatalogStore';
import { useSimStore } from '@/store/useSimStore';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors, medalDefault, medals, rarity as rarityTokens, shadows } from '@/theme/tokens';
import type { GminaStats } from '@/types';
import { fmtInt, gminaSubtitle, gminaTitle } from '@/utils/format';

export default function GminaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { stats } = useServices();
  const top = useTopInset();
  const gmina = useCatalogStore((s) => s.gminaById[id]);
  const network = useSimStore((s) => s.networkEnabled);
  const data = useAsync(() => stats.getGminaStats(id), [id, network]);
  const following = useUserStore((s) => s.followedGminy.includes(id));

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/gminy'));

  if (!gmina) {
    return (
      <Screen>
        <View style={{ padding: 20, gap: 12 }}>
          <Txt f="b7" size={24}>
            Nie znaleziono gminy
          </Txt>
          <Button3D title="Wróć" onPress={back} />
        </View>
      </Screen>
    );
  }

  const d = data.data;
  return (
    <Screen hero>
      <Placeholder variant="hero" stripe={12} label="zdjęcie lasu gminy" style={{ height: 230 }}>
        <IconButton
          icon="arrow_back"
          variant="photo"
          onPress={back}
          accessibilityLabel="Wstecz"
          style={{ position: 'absolute', left: 20, top: top + 8 }}
        />
        <Pill
          label={following ? 'Obserwujesz' : 'Obserwuj'}
          icon={following ? 'notifications_active' : 'notifications'}
          iconFilled={following}
          iconSize={18}
          size={14}
          padV={9}
          padH={14}
          gap={5}
          bg={following ? colors.primaryTint : colors.white}
          color={following ? colors.primaryTintText : colors.ink}
          shadow={shadows.photoButton}
          style={{ position: 'absolute', right: 20, top: top + 10 }}
          onPress={() => {
            const on = toggleFollow(gmina.id);
            ui.toast(on ? `Obserwujesz gminę ${gmina.name}` : 'Nie obserwujesz już tej gminy', on ? 'notifications_active' : 'notifications');
          }}
        />
      </Placeholder>
      <Sheet overlap={26}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Txt f="b7" size={30} lh={1.1}>
              {gminaTitle(gmina)}
            </Txt>
            <Txt f="n7" size={14} color={colors.muted}>
              {gminaSubtitle(gmina)}
            </Txt>
          </View>
          {d ? (
            <View
              style={{
                backgroundColor: medals[d.rank - 1] ?? medalDefault,
                borderRadius: 14,
                paddingVertical: 6,
                paddingHorizontal: 10,
                boxShadow: shadows.rankBadge,
              }}
            >
              <Txt f="b7" size={18} color={colors.legendBadgeInk}>
                #{d.rank}
              </Txt>
            </View>
          ) : null}
        </View>

        {data.error ? (
          <OfflineCard onRetry={data.reload} />
        ) : !d ? (
          <Loading />
        ) : (
          <Body gminaId={gmina.id} d={d} />
        )}

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4, paddingBottom: 8 }}>
          <Icon name="schedule" size={16} color={colors.muted} />
          <Txt f="n6" size={12} color={colors.muted} style={{ flex: 1 }}>
            Znaleziska pojawiają się po zakończeniu wypraw, bez dokładnych lokalizacji.
          </Txt>
        </View>
      </Sheet>
    </Screen>
  );
}

function Loading() {
  return (
    <View style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ flex: 1, backgroundColor: colors.card, borderRadius: 16, padding: 10, gap: 6, boxShadow: shadows.card }}>
            <Bone w="70%" h={20} />
            <Bone w="50%" h={10} />
          </View>
        ))}
      </View>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonCard lines={4} />
    </View>
  );
}

function Body({ gminaId, d }: { gminaId: string; d: GminaStats }) {
  const accepted = useUserStore((s) => (d.challenge ? s.challenges.some((c) => c.id === d.challenge!.id) : false));
  const maxPct = Math.max(...d.distribution.map((x) => x.pct));

  const onAccept = () => {
    if (!d.challenge) return;
    if (accepted) {
      router.navigate('/');
      return;
    }
    acceptChallenge(gminaId, d.challenge);
    router.navigate('/');
    setTimeout(() => ui.toast('Wyzwanie przyjęte! Znajdziesz je w zadaniach dnia', 'flag'), 350);
  };

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <StatTile value={fmtInt(d.mushroomers)} label="grzybiarzy" valueSize={20} labelSize={11} radius={16} padding={{ v: 10, h: 10 }} />
        <StatTile value={fmtInt(d.mushrooms)} label="grzybów" valueSize={20} labelSize={11} radius={16} padding={{ v: 10, h: 10 }} />
        <StatTile value={String(d.species)} label="gatunki" valueSize={20} labelSize={11} radius={16} padding={{ v: 10, h: 10 }} />
      </View>

      <View style={{ gap: 10 }}>
        <Txt f="b7" size={18}>
          Rekordy gminy
        </Txt>
        {d.records.map((rec) => {
          const r = rarityTokens[rec.rarity];
          return (
            <View
              key={rec.speciesName + rec.value}
              style={{
                backgroundColor: colors.card,
                borderRadius: 18,
                padding: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                boxShadow: shadows.card,
              }}
            >
              <Thumb size={58} radius={16} borderColor={r.color} />
              <View style={{ flex: 1 }}>
                <Txt f="n8" size={11} color={r.text} upper ls={0.08}>
                  {r.label}
                </Txt>
                <Txt f="n8" size={15}>
                  {rec.speciesName} · {rec.value}
                </Txt>
                <Txt f="n7" size={12} color={colors.muted}>
                  {rec.author} · {rec.when}
                </Txt>
              </View>
            </View>
          );
        })}
      </View>

      <View style={{ backgroundColor: colors.card, borderRadius: 22, padding: 16, gap: 10, boxShadow: shadows.card }}>
        <Txt f="b7" size={18}>
          Co tu się zbiera
        </Txt>
        {d.distribution.map((sp) => (
          <View key={sp.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt f="n7" size={13} style={{ width: 120 }}>
              {sp.name}
            </Txt>
            <View style={{ flex: 1, height: 12, borderRadius: 999, backgroundColor: colors.track, overflow: 'hidden' }}>
              <View
                style={{
                  height: '100%',
                  borderRadius: 999,
                  backgroundColor: colors.primary,
                  width: `${Math.round((sp.pct / maxPct) * 100)}%`,
                }}
              />
            </View>
            <Txt f="n8" size={13} color={colors.muted} align="right" style={{ width: 34 }}>
              {sp.pct}%
            </Txt>
          </View>
        ))}
      </View>

      {d.challenge ? (
        <View style={{ backgroundColor: colors.forest, borderRadius: 24, padding: 18, gap: 10, boxShadow: shadows.forest }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="flag" filled size={18} color={colors.xpOnDark} />
            <Txt f="n8" size={12} color={colors.xpOnDark} upper ls={0.08}>
              Wyzwanie gminy
            </Txt>
          </View>
          <Txt f="b7" size={22} lh={1.15} color={colors.onDark}>
            {d.challenge.title}
          </Txt>
          <Txt f="n7" size={13} color={colors.onDark} style={{ opacity: 0.85 }}>
            {d.challenge.description}
          </Txt>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill label={`+${d.challenge.xp} XP`} bg="rgba(255,255,255,0.12)" color={colors.onDark} padH={11} />
            <Pill label={`Odznaka „${d.challenge.badgeName}”`} bg="rgba(255,255,255,0.12)" color={colors.onDark} padH={11} />
          </View>
          <Button3D
            title={accepted ? 'Wyzwanie przyjęte ✓' : 'Przyjmij wyzwanie'}
            size="md"
            onDark
            onPress={onAccept}
            style={{ marginTop: 4 }}
          />
        </View>
      ) : null}
    </>
  );
}
