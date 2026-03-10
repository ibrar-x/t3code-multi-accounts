import { create } from "zustand";

interface ConfirmDialogRequest {
  readonly id: number;
  readonly message: string;
  readonly resolve: (value: boolean) => void;
}

interface ConfirmDialogState {
  readonly queue: readonly ConfirmDialogRequest[];
  enqueue: (request: ConfirmDialogRequest) => void;
  resolveRequest: (id: number, value: boolean) => void;
  clearAll: () => void;
}

let nextConfirmRequestId = 1;

export const useConfirmDialogState = create<ConfirmDialogState>((set) => ({
  queue: [],
  enqueue: (request) =>
    set((state) => ({
      queue: [...state.queue, request],
    })),
  resolveRequest: (id, value) =>
    set((state) => {
      const match = state.queue.find((request) => request.id === id);
      if (match) {
        match.resolve(value);
      }
      return {
        queue: state.queue.filter((request) => request.id !== id),
      };
    }),
  clearAll: () =>
    set((state) => {
      for (const request of state.queue) {
        request.resolve(false);
      }
      return { queue: [] };
    }),
}));

export function showConfirmDialogFallback(message: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    useConfirmDialogState.getState().enqueue({
      id: nextConfirmRequestId++,
      message,
      resolve,
    });
  });
}

