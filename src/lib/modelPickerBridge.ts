import { useSyncExternalStore } from 'react';
import type { Model } from '@shared/types';
import type { ModelConfig } from '../types/misc.ts';

export type ConversationModelPickerBinding = {
  models: ModelConfig[];
  selectedModel: string;
  onModelChange: (modelId: Model) => void;
  disabled: boolean;
  type: 'parametric' | 'creative';
};

const bindings = new Map<string, ConversationModelPickerBinding>();
const listeners = new Map<string, Set<() => void>>();

function emit(conversationId: string) {
  listeners.get(conversationId)?.forEach((listener) => listener());
}

export function registerConversationModelPicker(
  conversationId: string,
  binding: ConversationModelPickerBinding,
): () => void {
  if (!conversationId) return () => undefined;

  bindings.set(conversationId, binding);
  emit(conversationId);

  return () => {
    if (bindings.get(conversationId) === binding) {
      bindings.delete(conversationId);
      emit(conversationId);
    }
  };
}

export function getConversationModelPicker(
  conversationId: string,
): ConversationModelPickerBinding | undefined {
  return conversationId ? bindings.get(conversationId) : undefined;
}

function subscribeConversationModelPicker(
  conversationId: string,
  listener: () => void,
): () => void {
  if (!conversationId) return () => undefined;

  const conversationListeners = listeners.get(conversationId) ?? new Set();
  conversationListeners.add(listener);
  listeners.set(conversationId, conversationListeners);

  return () => {
    const current = listeners.get(conversationId);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(conversationId);
  };
}

export function useConversationModelPicker(
  conversationId: string,
): ConversationModelPickerBinding | undefined {
  return useSyncExternalStore(
    (listener) => subscribeConversationModelPicker(conversationId, listener),
    () => getConversationModelPicker(conversationId),
    () => undefined,
  );
}

export const __modelPickerBridgeTestUtils = {
  clear() {
    bindings.clear();
    listeners.clear();
  },
};
