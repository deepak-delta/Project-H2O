import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, tone?: ToastTone) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, tone = 'success') => {
    const id = nextId++;
    set({ toasts: [...get().toasts.slice(-2), { id, message, tone }] });
    window.setTimeout(() => get().dismiss(id), tone === 'success' ? 3000 : 6000);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (message: string) => useToasts.getState().show(message, 'success'),
  error: (message: string) => useToasts.getState().show(message, 'error'),
  info: (message: string) => useToasts.getState().show(message, 'info'),
};
