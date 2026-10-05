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

/** Skróty dla ekranów. */
export const ui = {
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
