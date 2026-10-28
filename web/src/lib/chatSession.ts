const ACTIVE_CONVERSATION_KEY = "leadgun.active-conversation";

export const NEW_CHAT_EVENT = "leadgun:new-chat";

export function readActiveConversation(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_CONVERSATION_KEY);
  } catch {
    return null;
  }
}

export function rememberActiveConversation(id: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_CONVERSATION_KEY, id);
    else window.localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  } catch {}
}
