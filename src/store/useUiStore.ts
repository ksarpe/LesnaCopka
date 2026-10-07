import { create } from 'zustand';

import type { IconName } from '@/components/Icon';

export interface DialogAction {
  label: string;
  style?: 'primary' | 'danger' | 'cancel' | 'default';
  onPress?: () => void;
}

export interface DialogState {
  id: number;
  /** dialog = karta w stylu aplikacji; system = imitacja systemowego promptu iOS. */
  variant: 'dialog' | 'system';
  title: string;
  message?: string;
  icon?: IconName;
  actions: DialogAction[];
}

export interface ToastState {
  id: number;
  text: string;
  icon?: IconName;
}

interface UiState {
  toast: ToastState | null;
  dialog: DialogState | null;
  showToast: (text: string, icon?: IconName) => void;
  hideToast: () => void;
  showDialog: (d: Omit<DialogState, 'id' | 'variant'> & { variant?: DialogState['variant'] }) => void;
  closeDialog: () => void;
}

let seq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUiStore = create<UiState>()((set) => ({
  toast: null,
  dialog: null,
  showToast: (text, icon) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: { id: ++seq, text, icon } });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
  hideToast: () => set({ toast: null }),
  showDialog: (d) => set({ dialog: { variant: 'dialog', ...d, id: ++seq } }),
  closeDialog: () => set({ dialog: null }),
}));

/**
 * Dialog z wyborem jako obietnica: wartość wybranej akcji albo null, gdy dialog zamknięto inaczej (tło, wstecz).
 * Akcja przychodzi po zamknięciu dialogu z opóźnieniem (UiHost) – zamknięcie „bez wyboru” czekamy dłużej.
 */
function choose<T extends string>(opts: {
  title: string;
  message?: string;
  icon?: IconName;
  actions: { label: string; style?: DialogAction['style']; value: T | null }[];
}): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    let unsub = () => {};
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      unsub();
      resolve(v);
    };
    useUiStore.getState().showDialog({
      title: opts.title,
      message: opts.message,
      icon: opts.icon,
      actions: opts.actions.map((a) => ({ label: a.label, style: a.style, onPress: () => finish(a.value) })),
    });
    const id = useUiStore.getState().dialog?.id;
    unsub = useUiStore.subscribe((s) => {
      if (s.dialog?.id !== id) setTimeout(() => finish(null), 600);
    });
  });
}

/** Skróty dla ekranów. */
export const ui = {
  choose,
  toast: (text: string, icon?: IconName) => useUiStore.getState().showToast(text, icon),
  soon: (what?: string) => useUiStore.getState().showToast(what ? `${what} – wkrótce` : 'Wkrótce', 'schedule'),
  confirm: (opts: {
    title: string;
    message?: string;
    icon?: IconName;
    confirmLabel: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
  }) =>
    useUiStore.getState().showDialog({
      title: opts.title,
      message: opts.message,
      icon: opts.icon,
      actions: [
        { label: opts.cancelLabel ?? 'Anuluj', style: 'cancel' },
        { label: opts.confirmLabel, style: opts.danger ? 'danger' : 'primary', onPress: opts.onConfirm },
      ],
    }),
};
