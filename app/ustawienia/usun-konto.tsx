import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Button3D } from '@/components/Button3D';
import { Card } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { Txt } from '@/components/Txt';
import { useAsync } from '@/hooks/useAsync';
import { useServices } from '@/services';
import { useMockDb } from '@/services/mock/db';
import { deletionPreview, type DeletionPreview } from '@/services/supabase/account';
import { supabaseEnabled } from '@/services/supabase/client';
import { deleteMyAccount, runExport } from '@/store/account';
import { useTripStore } from '@/store/useTripStore';
import { ui } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors } from '@/theme/tokens';
import { fmtInt, plural } from '@/utils/format';
import { handleBody } from '@/utils/profile';

/** Co zniknie – tryb mock: liczone z danych w telefonie (i „serwera” mocków). */
function localPreview(): DeletionPreview {
  const { trips, finds } = useTripStore.getState();
  const u = useUserStore.getState();
  const db = useMockDb.getState();
  return {
    trips: Object.keys(trips).length,
    finds: Object.values(finds).filter((f) => f.status === 'claimed').length,
    species: Object.keys(u.atlas).length,
    posts: db.posts.filter((p) => p.kind === 'trip' && p.mine).length,
    comments: Object.values(db.comments)
      .flat()
      .filter((c) => c.mine).length,
    friends: db.friendIds.length,
  };
}

const n = (v: number, one: string, few: string, many: string) => `${fmtInt(v)} ${plural(v, one, few, many)}`;

/** Ustawienia → Konto → „Usuń konto”: skutki, potwierdzenie nickiem, usunięcie (serwer + telefon) → onboarding. */
export default function DeleteAccountScreen() {
  const services = useServices();
  const handle = useUserStore((s) => handleBody(s.user.handle));
  const preview = useAsync(() => (supabaseEnabled ? deletionPreview() : Promise.resolve(localPreview())), []);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const back = () => (router.canGoBack() ? router.back() : router.navigate('/ustawienia' as Href));

  const matches = !!handle && handleBody(confirm) === handle;
  const p = preview.data;

  const run = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await deleteMyAccount(services);
      if (r.ok) {
        // Układ sam przełącza się na onboarding (nowe konto) – toast pokaże ekran powitalny.
        setTimeout(() => ui.toast('Konto usunięte. Do zobaczenia w lesie!', 'delete_forever'), 300);
        return;
      }
      setError(r.message);
    } catch (e) {
      setError(`Nie udało się usunąć konta (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingTop: 6, paddingHorizontal: 20, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
          <Txt f="b7" size={18}>
            Usuń konto
          </Txt>
          <View style={{ width: 44 }} />
        </View>

        <View
          style={{
            backgroundColor: colors.dangerBg,
            borderWidth: 2,
            borderColor: colors.dangerBorder,
            borderRadius: 22,
            padding: 16,
            flexDirection: 'row',
            gap: 12,
          }}
        >
          <Icon name="delete_forever" filled size={30} color={colors.danger} />
          <View style={{ flex: 1, gap: 4 }}>
            <Txt f="b7" size={19} lh={1.25} color={colors.dangerTitle}>
              Tego nie da się cofnąć
            </Txt>
            <Txt f="n6" size={13} color={colors.dangerText}>
              {supabaseEnabled
                ? 'Usuniemy Twoje konto i wszystkie dane z serwera i z tego telefonu. Nie odzyskasz ich – także logując się ponownie tym samym adresem e-mail.'
                : 'Usuniemy wszystkie Twoje dane z tego telefonu. Nie odzyskasz ich.'}
            </Txt>
          </View>
        </View>

        <Card radius={22} padding={16} gap={12}>
          <Txt f="b7" size={18}>
            Co zniknie
          </Txt>
          {preview.loading && !p ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Line icon="hiking" text={p ? `${n(p.trips, 'wyprawa', 'wyprawy', 'wypraw')} i ${n(p.finds, 'znalezisko', 'znaleziska', 'znalezisk')}` : 'Wyprawy i znaleziska'} />
              <Line
                icon="menu_book"
                text={`Atlas${p ? ` (${n(p.species, 'gatunek', 'gatunki', 'gatunków')})` : ''}, odznaki, osiągnięcia, XP i poziom`}
              />
              <Line
                icon="forum"
                text={p ? `${n(p.posts, 'wpis', 'wpisy', 'wpisów')}, ${n(p.comments, 'komentarz', 'komentarze', 'komentarzy')} i Twoje reakcje` : 'Wpisy, komentarze i reakcje'}
              />
              <Line icon="group" text={p ? `${n(p.friends, 'znajomy', 'znajomych', 'znajomych')}, zaproszenia i blokady` : 'Znajomi, zaproszenia i blokady'} />
              <Line icon="photo_library" text="Zdjęcia znalezisk, okładki wpisów i zdjęcie profilowe" />
              {supabaseEnabled ? <Line icon="mail" text="Konto i adres e-mail – logowanie kodem przestanie działać" /> : null}
              {preview.error ? (
                <Txt f="n6" size={12} color={colors.muted}>
                  Nie udało się policzyć Twoich danych (brak połączenia?) – usunięcie konta i tak wymaga internetu.
                </Txt>
              ) : null}
              <Txt f="n6" size={12} color={colors.muted}>
                Rankingi i statystyki gmin przeliczą się bez Twoich wypraw. Zostają tylko zbiorcze liczby, z których nie da się
                Cię rozpoznać.
              </Txt>
            </>
          )}
        </Card>

        <Pressable
          onPress={() => void runExport()}
          accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <Icon name="download" size={20} color={colors.outlineText} />
          <Txt f="b7" size={16} color={colors.outlineText}>
            Najpierw pobierz kopię swoich danych
          </Txt>
        </Pressable>

        <TextField
          label={`Wpisz swój nick (@${handle}), aby potwierdzić`}
          prefix="@"
          value={confirm}
          onChangeText={(t) => setConfirm(t.replace(/^@+/, '').replace(/\s/g, '').toLowerCase())}
          placeholder={handle}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          editable={!busy}
          error={error}
        />

        <Button3D
          title={busy ? 'Usuwanie…' : 'Usuń konto na zawsze'}
          icon="delete_forever"
          tone="danger"
          onPress={() => void run()}
          disabled={!matches || busy}
        />
        <Pressable onPress={back} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: 'center', paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}>
          <Txt f="b7" size={16} color={colors.outlineText}>
            Zostaję
          </Txt>
        </Pressable>
      </View>
    </Screen>
  );
}

function Line({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: colors.dangerBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} filled size={20} color={colors.danger} />
      </View>
      <Txt f="n7" size={14} color={colors.bodyDark} style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}
