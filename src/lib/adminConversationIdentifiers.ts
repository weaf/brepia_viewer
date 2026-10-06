const STORAGE_KEY = 'brepia.admin.showConversationIds';
export const ADMIN_CONVERSATION_IDS_EVENT =
  'brepia:admin-conversation-identifiers-changed';

export function readAdminConversationIdsEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

export function setAdminConversationIdsEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  window.dispatchEvent(
    new CustomEvent<boolean>(ADMIN_CONVERSATION_IDS_EVENT, {
      detail: enabled,
    }),
  );
}
