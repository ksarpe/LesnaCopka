import { useIsFocused } from 'expo-router';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';

import { useUiStore, type DialogAction, type DialogState } from '@/store/useUiStore';
import { colors, shadows } from '@/theme/tokens';
import { Icon } from './Icon';
import { Txt } from './Txt';

/**
 * Toast + dialogi renderowane wewnątrz aktywnego ekranu (także modali fullscreen),
 * dzięki czemu zawsze są nad bieżącą treścią – bez globalnej nakładki.
 */
export function UiHost({ toastBottom = 40 }: { toastBottom?: number }) {
  const focused = useIsFocused();
  const toast = useUiStore((s) => s.toast);
  const dialog = useUiStore((s) => s.dialog);
  if (!focused) return null;
  return (
    <>
      {toast ? (
        <Animated.View
          key={toast.id}
          entering={FadeInDown.duration(180)}
          exiting={FadeOutDown.duration(160)}
          pointerEvents="box-none"
          style={[styles.toastWrap, { bottom: toastBottom }]}
        >
          <Pressable onPress={() => useUiStore.getState().hideToast()} style={styles.toast}>
            {toast.icon ? <Icon name={toast.icon} filled size={18} color={colors.xpOnDark} /> : null}
            <Txt f="n8" size={14} color={colors.bg} style={{ flexShrink: 1 }}>
              {toast.text}
            </Txt>
          </Pressable>
        </Animated.View>
      ) : null}
      {dialog ? <DialogModal dialog={dialog} /> : null}
    </>
  );
}

function DialogModal({ dialog }: { dialog: DialogState }) {
  const close = useUiStore((s) => s.closeDialog);
  const press = (a: DialogAction) => {
    close();
    // Akcja po zamknięciu – pozwala bezpiecznie nawigować.
    setTimeout(() => a.onPress?.(), Platform.OS === 'ios' ? 220 : 0);
  };
  return (
    <Modal
      transparent
      animationType="fade"
      visible
      // Wstecz (Android) = akcja anulująca; prompt systemowy = odmowa, żeby nie zawiesić obietnicy.
      onRequestClose={() => {
        const fallback = dialog.actions.find((a) => a.style === 'cancel') ?? (dialog.variant === 'system' ? dialog.actions.at(-1) : undefined);
        if (fallback) press(fallback);
        else close();
      }}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        {dialog.variant === 'system' ? (
          <SystemAlert dialog={dialog} onPress={press} />
        ) : (
          <AppDialog dialog={dialog} onPress={press} onClose={close} />
        )}
      </View>
    </Modal>
  );
}

function AppDialog({ dialog, onPress, onClose }: { dialog: DialogState; onPress: (a: DialogAction) => void; onClose: () => void }) {
  const actions = dialog.actions;
  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      <View style={styles.card}>
        {dialog.icon ? (
          <View style={styles.dialogIcon}>
            <Icon name={dialog.icon} filled size={30} color={colors.primaryText} />
          </View>
        ) : null}
        <Txt f="b7" size={22} align="center" lh={1.15}>
          {dialog.title}
        </Txt>
        {dialog.message ? (
          <Txt f="n6" size={14} color={colors.muted} align="center">
            {dialog.message}
          </Txt>
        ) : null}
        <View style={{ gap: 10, alignSelf: 'stretch', marginTop: 6 }}>
          {[...actions]
            .sort((a, b) => (a.style === 'cancel' ? 1 : 0) - (b.style === 'cancel' ? 1 : 0))
            .map((a) => {
              const primary = a.style === 'primary';
              const danger = a.style === 'danger';
              const cancel = a.style === 'cancel';
              return (
                <Pressable
                  key={a.label}
                  onPress={() => onPress(a)}
                  style={({ pressed }) => [
                    styles.btn,
                    primary && { backgroundColor: colors.primary, boxShadow: `0px ${pressed ? 1 : 4}px 0px ${colors.primaryShadow}` },
                    danger && { backgroundColor: colors.danger, boxShadow: `0px ${pressed ? 1 : 4}px 0px #A83A24` },
                    (cancel || a.style === 'default' || !a.style) && { borderWidth: 2.5, borderColor: colors.outline },
                    pressed && { transform: [{ translateY: primary || danger ? 3 : 0 }], opacity: cancel ? 0.7 : 1 },
                  ]}
                >
                  <Txt
                    f="b7"
                    size={17}
                    align="center"
                    color={primary ? colors.primaryInk : danger ? colors.white : colors.outlineText}
                  >
                    {a.label}
                  </Txt>
                </Pressable>
              );
            })}
        </View>
      </View>
    </>
  );
}

/** Imitacja systemowego alertu iOS (prompt uprawnień w mocku). */
function SystemAlert({ dialog, onPress }: { dialog: DialogState; onPress: (a: DialogAction) => void }) {
  return (
    <View style={styles.sys}>
      <View style={{ paddingHorizontal: 16, paddingTop: 19, paddingBottom: 15, gap: 4 }}>
        <Text style={styles.sysTitle}>{dialog.title}</Text>
        {dialog.message ? <Text style={styles.sysMsg}>{dialog.message}</Text> : null}
      </View>
      {dialog.actions.map((a) => (
        <Pressable
          key={a.label}
          onPress={() => onPress(a)}
          style={({ pressed }) => [styles.sysBtn, pressed && { backgroundColor: 'rgba(0,0,0,0.06)' }]}
        >
          <Text style={[styles.sysBtnText, a.style === 'primary' && { fontWeight: '600' }]}>{a.label}</Text>
        </Pressable>
      ))}
      <View style={styles.sysMock}>
        <Text style={styles.sysMockText}>symulowany prompt systemowy</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: 20, right: 20, alignItems: 'center', zIndex: 50 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.ink,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    boxShadow: shadows.tooltip,
    maxWidth: 350,
  },
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
  dialogIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  btn: { borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14 },
  sys: {
    width: 270,
    borderRadius: 14,
    backgroundColor: 'rgba(242,242,247,0.98)',
    overflow: 'hidden',
  },
  sysTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center', color: '#000' },
  sysMsg: { fontSize: 13, textAlign: 'center', color: '#000', lineHeight: 18 },
  sysBtn: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(60,60,67,0.36)',
    paddingVertical: 11,
    alignItems: 'center',
  },
  sysBtnText: { fontSize: 17, color: '#007AFF' },
  sysMock: { paddingVertical: 4, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.04)' },
  sysMockText: { fontSize: 10, color: 'rgba(60,60,67,0.6)' },
});
