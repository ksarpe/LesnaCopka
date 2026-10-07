import { router, useNavigation, type Href } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, View, type TextInput } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { AvatarPresetGrid } from '@/components/AvatarPresetGrid';
import { Button3D } from '@/components/Button3D';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Screen } from '@/components/Screen';
import { TextField } from '@/components/TextField';
import { Txt } from '@/components/Txt';
import { useBottomPadding } from '@/hooks/useInsets';
import { canUseCamera, pickAvatarPhoto, pruneAvatarFiles, type AvatarSource } from '@/services/live/avatarPhoto';
import { syncAvatar, syncProfile } from '@/services/supabase/profile';
import { ui, useUiStore, type DialogAction } from '@/store/useUiStore';
import { useUserStore } from '@/store/useUserStore';
import { colors } from '@/theme/tokens';
import type { UserAvatar } from '@/types';
import {
  BIO_MAX,
  bioError,
  cleanBio,
  cleanName,
  firstNameOf,
  handleBody,
  handleError,
  HANDLE_MAX,
  NAME_MAX,
  nameError,
  normalizeHandle,
} from '@/utils/profile';

const AVATAR_SIZE = 116;

function sameAvatar(a?: UserAvatar, b?: UserAvatar) {
  if (!a || !b) return a === b;
  return a.kind === 'preset' ? b.kind === 'preset' && a.id === b.id : b.kind === 'photo' && a.uri === b.uri;
}

/** Bieżący avatar w store – jego pliku nie wolno usunąć przy sprzątaniu. */
function keepCurrentAvatar() {
  const cur = useUserStore.getState().user.avatar;
  pruneAvatarFiles(cur?.kind === 'photo' ? cur.uri : undefined);
}

/** Edycja profilu (Ustawienia → Edytuj profil, tap w avatar w Profilu). */
export default function EditProfileScreen() {
  const navigation = useNavigation();
  const bottom = useBottomPadding();
  const user = useUserStore((s) => s.user);

  const [name, setName] = useState(user.name);
  const [handle, setHandle] = useState(handleBody(user.handle));
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatar, setAvatar] = useState<UserAvatar | undefined>(user.avatar);
  const [presetsOpen, setPresetsOpen] = useState(user.avatar?.kind === 'preset');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const mounted = useRef(true);
  const handleRef = useRef<TextInput>(null);
  const bioRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const formY = useRef(0);
  const fieldY = useRef<Record<'name' | 'handle' | 'bio', number>>({ name: 0, handle: 0, bio: 0 });

  // Telefon: po pojawieniu się klawiatury (KeyboardAvoidingView zmniejsza widok) przewijamy pole pod nagłówek.
  const reveal = (field: 'name' | 'handle' | 'bio') => {
    if (Platform.OS === 'web') return;
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, formY.current + fieldY.current[field] - 16), animated: true });
    }, 280);
  };

  // Błędy pokazujemy dopiero, gdy pole różni się od zapisanego (nie straszymy na wejściu).
  const nameErr = cleanName(name) !== user.name ? nameError(name) : null;
  const handleErr = normalizeHandle(handle) !== user.handle ? handleError(handle) : null;
  const bioErr = bioError(bio);
  const valid = !nameError(name) && !handleError(handle) && !bioErr;
  const dirty =
    cleanName(name) !== user.name ||
    normalizeHandle(handle) !== user.handle ||
    cleanBio(bio) !== (user.bio ?? '') ||
    !sameAvatar(avatar, user.avatar);

  // Wyjście z niezapisanymi zmianami (wstecz, gest iOS, przycisk Androida) → potwierdzenie.
  usePreventRemove(dirty && !saved, ({ data }) => {
    ui.confirm({
      title: 'Odrzucić zmiany?',
      message: 'Masz niezapisane zmiany w profilu.',
      icon: 'edit',
      confirmLabel: 'Odrzuć zmiany',
      cancelLabel: 'Zostań',
      danger: true,
      onConfirm: () => navigation.dispatch(data.action),
    });
  });

  const back = () => (router.canGoBack() ? router.back() : router.navigate('/ustawienia' as Href));

  // Po zapisie wracamy dopiero, gdy blokada wyjścia jest już zdjęta (efekt po renderze).
  useEffect(() => {
    if (saved) back();
  }, [saved]);

  // Zdjęcia wybrane, ale niezapisane, nie zostają na dysku.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      keepCurrentAvatar();
    };
  }, []);

  const save = () => {
    if (!dirty || !valid) return;
    const n = cleanName(name);
    const h = normalizeHandle(handle);
    const b = cleanBio(bio);
    const u = useUserStore.getState();
    // Ten sam avatar – zostaje wersja ze store (z `path`, jeśli zdjęcie jest już na serwerze).
    const avatarChanged = !sameAvatar(avatar, u.user.avatar);
    const nextAvatar = avatarChanged ? avatar : u.user.avatar;
    u.patch({ user: { ...u.user, name: n, firstName: firstNameOf(n), handle: h, bio: b || undefined, avatar: nextAvatar } });
    keepCurrentAvatar();
    void syncProfile({ name: n, firstName: firstNameOf(n), handle: h });
    if (avatarChanged) syncAvatar();
    ui.toast('Profil zapisany', 'check_circle');
    setSaved(true);
  };

  const pick = async (source: AvatarSource) => {
    // iOS nie pokaże pickera, dopóki dialog akcji nie zniknie do końca.
    if (Platform.OS === 'ios') await new Promise((r) => setTimeout(r, 350));
    setBusy(true);
    const res = await pickAvatarPhoto(source);
    if (!mounted.current) return;
    setBusy(false);
    if (res.status === 'ok') {
      setAvatar({ kind: 'photo', uri: res.uri });
      setPresetsOpen(false);
    } else if (res.status === 'denied') {
      if (res.canAskAgain) ui.toast('Bez zgody na aparat nie zrobimy zdjęcia', 'no_photography');
      else
        useUiStore.getState().showDialog({
          title: 'Brak dostępu do aparatu',
          icon: 'no_photography',
          message: 'Zezwól na dostęp do aparatu w ustawieniach telefonu albo wybierz zdjęcie z galerii.',
          actions: [
            { label: 'Otwórz ustawienia', style: 'primary', onPress: () => void Linking.openSettings().catch(() => {}) },
            { label: 'Anuluj', style: 'cancel' },
          ],
        });
    } else if (res.status === 'error') {
      ui.toast('Nie udało się wczytać zdjęcia', 'broken_image');
    }
  };

  const changePhoto = () => {
    const actions: DialogAction[] = [];
    if (canUseCamera) actions.push({ label: 'Zrób zdjęcie', style: 'default', onPress: () => void pick('camera') });
    actions.push({ label: 'Wybierz z galerii', style: 'default', onPress: () => void pick('library') });
    actions.push({ label: 'Motyw grzybowy', style: 'default', onPress: () => setPresetsOpen(true) });
    if (avatar) {
      actions.push({
        label: avatar.kind === 'photo' ? 'Usuń zdjęcie' : 'Usuń motyw',
        style: 'danger',
        onPress: () => {
          setAvatar(undefined);
          setPresetsOpen(false);
        },
      });
    }
    actions.push({ label: 'Anuluj', style: 'cancel' });
    useUiStore.getState().showDialog({ title: 'Zdjęcie profilowe', icon: 'add_a_photo', actions });
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingTop: 6, paddingHorizontal: 20, gap: 18, paddingBottom: bottom + 12 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <IconButton icon="arrow_back" onPress={back} accessibilityLabel="Wróć" />
            <Txt f="b7" size={18}>
              Edytuj profil
            </Txt>
            <View style={{ width: 44 }} />
          </View>

          <View style={{ alignItems: 'center', gap: 12 }}>
            <Pressable onPress={changePhoto} disabled={busy} accessibilityRole="button" accessibilityLabel="Zmień zdjęcie profilowe">
              <Avatar size={AVATAR_SIZE} ringWidth={4} stripe={7} avatar={avatar} />
              {busy ? (
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: AVATAR_SIZE / 2,
                    backgroundColor: 'rgba(30,27,22,0.45)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <ActivityIndicator color={colors.white} />
                </View>
              ) : null}
              <View
                style={{
                  position: 'absolute',
                  right: -2,
                  bottom: 2,
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  borderWidth: 3,
                  borderColor: colors.bg,
                  backgroundColor: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="photo_camera" filled size={18} color={colors.primaryInk} />
              </View>
            </Pressable>
            <Pressable
              onPress={changePhoto}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => ({
                borderWidth: 2.5,
                borderColor: colors.outline,
                borderRadius: 999,
                paddingVertical: 6,
                paddingHorizontal: 16,
                backgroundColor: pressed ? colors.outlineHover : 'transparent',
              })}
            >
              <Txt f="b7" size={15} color={colors.outlineText}>
                Zmień zdjęcie
              </Txt>
            </Pressable>
          </View>

          {presetsOpen ? (
            <Card radius={22} padding={16} gap={12}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Txt f="b7" size={17}>
                    Motyw grzybowy
                  </Txt>
                  <Txt f="n6" size={12} color={colors.muted}>
                    Zamiast zdjęcia – ikona na kolorowym tle
                  </Txt>
                </View>
                <Pressable onPress={() => setPresetsOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Zwiń motywy">
                  <Icon name="close" size={22} color={colors.faint} />
                </Pressable>
              </View>
              <AvatarPresetGrid
                selectedId={avatar?.kind === 'preset' ? avatar.id : null}
                onSelect={(id) => setAvatar({ kind: 'preset', id })}
              />
            </Card>
          ) : null}

          <View style={{ gap: 14 }} onLayout={(e) => (formY.current = e.nativeEvent.layout.y)}>
            <TextField
              onLayout={(e) => (fieldY.current.name = e.nativeEvent.layout.y)}
              onFocus={() => reveal('name')}
              label="Imię i nazwisko"
              value={name}
              onChangeText={setName}
              error={nameErr}
              hint="Widzą je znajomi w feedzie"
              placeholder="np. Kuba Nowak"
              maxLength={NAME_MAX}
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => handleRef.current?.focus()}
            />
            <TextField
              ref={handleRef}
              onLayout={(e) => (fieldY.current.handle = e.nativeEvent.layout.y)}
              onFocus={() => reveal('handle')}
              label="Nick"
              prefix="@"
              value={handle}
              // Nick zawsze małymi literami i bez spacji; „@” jest stałym przedrostkiem pola.
              onChangeText={(t) => setHandle(t.replace(/^@+/, '').replace(/\s/g, '').toLowerCase())}
              error={handleErr}
              hint="3–20 znaków: litery a–z, cyfry, kropka i podkreślnik"
              placeholder="kuba.grzyb"
              maxLength={HANDLE_MAX}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              textContentType="none"
              spellCheck={false}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => bioRef.current?.focus()}
            />
            <TextField
              ref={bioRef}
              onLayout={(e) => (fieldY.current.bio = e.nativeEvent.layout.y)}
              onFocus={() => reveal('bio')}
              label="O mnie"
              value={bio}
              onChangeText={setBio}
              error={bioErr}
              counter={{ value: bio.length, max: BIO_MAX }}
              placeholder="np. Borowiki tylko z Puszczy Knyszyńskiej"
              maxLength={BIO_MAX}
              multiline
              autoCapitalize="sentences"
            />
          </View>

          <Button3D title="Zapisz" icon="check" onPress={save} disabled={!dirty || !valid || busy} style={{ marginTop: 4 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
