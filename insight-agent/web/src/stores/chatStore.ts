import { create } from "zustand";
import { chatApi } from "@/api/chat";
import type { ConversationResponse, MessageSchema } from "@/types";

type MessageState = Record<number, MessageSchema[]>;

interface ChatState {
  conversations: ConversationResponse[];
  messagesByConversation: MessageState;
  isLoadingMessages: boolean;
  connectionState: "idle" | "connecting" | "open" | "closed";
  streamingConversations: Set<number>;
  setConnectionState: (state: ChatState["connectionState"]) => void;
  loadConversations: () => Promise<ConversationResponse[]>;
  createConversation: () => Promise<ConversationResponse>;
  deleteConversation: (conversationId: number) => Promise<void>;
  loadMessages: (conversationId: number) => Promise<MessageSchema[]>;
  ensureConversation: (conversation: ConversationResponse) => void;
  // === 2026-06-09 新增：后端 LLM 总结标题后通过 WebSocket 推过来，前端 store 更新
  updateConversationTitle: (conversationId: number, title: string) => void;
  // === 2026-06-09 新增：双击会话名→调 API 改标题
  renameConversation: (conversationId: number, title: string) => Promise<void>;
  // === 新增结束 ===
  appendMessage: (conversationId: number, message: MessageSchema) => void;
  markStreaming: (conversationId: number) => void;
  unmarkStreaming: (conversationId: number) => void;
}

export const useChatStore = create<ChatState>()((set, _get) => ({
  conversations: [],
  messagesByConversation: {},
  isLoadingMessages: false,
  connectionState: "idle",
  streamingConversations: new Set<number>(),

  setConnectionState: (connectionState) => set({ connectionState }),

  loadConversations: async () => {
    const response = await chatApi.listConversations();
    const conversations = response.data.conversations;
    set({ conversations });
    return conversations;
  },

  createConversation: async () => {
    const response = await chatApi.createConversation();
    const conversation = response.data;
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversation.conversation_id]: [],
      },
    }));
    return conversation;
  },

  deleteConversation: async (conversationId) => {
    await chatApi.deleteConversations([conversationId]);
    set((state) => {
      const nextMessages = { ...state.messagesByConversation };
      delete nextMessages[conversationId];
      return {
        conversations: state.conversations.filter(
          (conversation) => conversation.conversation_id !== conversationId
        ),
        messagesByConversation: nextMessages,
      };
    });
  },

  loadMessages: async (conversationId) => {
    set({ isLoadingMessages: true });
    try {
      const response = await chatApi.getMessages(conversationId);
      const messages = response.data.messages;
      set((state) => ({
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: messages,
        },
      }));
      return messages;
    } finally {
      set({ isLoadingMessages: false });
    }
  },

  ensureConversation: (conversation) =>
    set((state) => {
      const exists = state.conversations.some(
        (item) => item.conversation_id === conversation.conversation_id
      );
      if (exists) {
        return state;
      }
      return {
        conversations: [conversation, ...state.conversations],
      };
    }),

  // === 2026-06-09 新增 ===
  updateConversationTitle: (conversationId, title) =>
    set((state) => {
      // 找到对应的 conversation，替换 title
      // 找不到时不报错（可能 sidebar 还没加载）
      const idx = state.conversations.findIndex(
        (c) => c.conversation_id === conversationId
      );
      if (idx < 0) {
        return state;
      }
      const next = [...state.conversations];
      next[idx] = { ...next[idx], title };
      return { conversations: next };
    }),
  // === 新增结束 ===

  // === 2026-06-09 新增：双击会话名重命名
  // 1. 调后端 POST /api/chat/update（持久化）
  // 2. 失败时回滚本地 title（不污染 UI）
  // 3. 不检查 LLM 自动覆盖——用户主动改了就以用户为准
  renameConversation: async (conversationId, title) => {
    const trimmed = title.trim();
    if (!trimmed) {
      throw new Error("标题不能为空");
    }
    // 1. 乐观更新本地（先让 UI 立刻反映）
    let previousTitle: string | undefined;
    set((state) => {
      const idx = state.conversations.findIndex(
        (c) => c.conversation_id === conversationId
      );
      if (idx < 0) {
        return state;
      }
      previousTitle = state.conversations[idx].title;
      const next = [...state.conversations];
      next[idx] = { ...next[idx], title: trimmed };
      return { conversations: next };
    });
    // 2. 调 API 持久化
    try {
      await chatApi.updateConversation(conversationId, trimmed);
    } catch (err) {
      // 3. 失败回滚
      if (previousTitle !== undefined) {
        set((state) => {
          const idx = state.conversations.findIndex(
            (c) => c.conversation_id === conversationId
          );
          if (idx < 0) return state;
          const next = [...state.conversations];
          next[idx] = { ...next[idx], title: previousTitle as string };
          return { conversations: next };
        });
      }
      throw err;
    }
  },
  // === 新增结束 ===

  appendMessage: (conversationId, message) =>
    set((state) => ({
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: [...(state.messagesByConversation[conversationId] ?? []), message],
      },
    })),

  markStreaming: (conversationId) =>
    set((state) => ({
      streamingConversations: new Set([...state.streamingConversations, conversationId]),
    })),

  unmarkStreaming: (conversationId) =>
    set((state) => {
      const next = new Set(state.streamingConversations);
      next.delete(conversationId);
      return { streamingConversations: next };
    }),
}));
