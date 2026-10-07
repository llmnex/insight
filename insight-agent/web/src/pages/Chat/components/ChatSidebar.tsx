import { LogOut, MessageSquareMore, Plus, Trash2, User2 } from "lucide-react";
// === 2026-06-09 改造：去掉 import { Link }，改用 useNavigate + onClick
// 原因：<Link> 默认响应 onClick 抢走双击事件，导致双击进入编辑的同时
//       Link 触发 navigate → 路由参数变化 → useEffect cleanup → WebSocket 关闭
// === 改造结束 ===
import { useNavigate } from "react-router-dom";
import { buildAuthProfileRedirectUrl } from "@/auth";
import type { UserResponse } from "@/auth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ROUTES } from "@/config/settings";
import { cn } from "@/lib/utils";
import type { ConversationResponse } from "@/types";
// === 2026-06-09 新增：双击会话名编辑的子组件 ===
import { ConversationTitleItem } from "./ConversationTitleItem";
// === 新增结束 ===

interface ChatSidebarProps {
  conversations: ConversationResponse[];
  activeConversationId: number | null;
  user: UserResponse | null;
  onCreate: () => void;
  onDelete: (conversationId: number) => void;
  // === 2026-06-09 新增：重命名回调（由父组件传 store.renameConversation）===
  onRename: (conversationId: number, newTitle: string) => Promise<void>;
  // === 新增结束 ===
  onLogout: () => void;
}

export function ChatSidebar({
  conversations,
  activeConversationId,
  user,
  onCreate,
  onDelete,
  onRename,
  onLogout,
}: ChatSidebarProps) {
  // === 2026-06-09 改造：用 useNavigate + onClick 替代 <Link>
  // 原因：之前用 <Link> 包住 <ConversationTitleItem>，双击时 Link 的 onClick 抢先触发
  //       navigate → 路由参数变化 → useEffect cleanup → WebSocket 关闭
  //       改造后：手动调 navigate，ConversationTitleItem 内部可以正确处理双击
  // === 改造结束 ===
  const navigate = useNavigate();
  // 用户信息按钮跳转到认证中心个人页，并把当前聊天页作为返回地址
  const profileUrl = buildAuthProfileRedirectUrl(window.location.href);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-none border-r border-[#e6dfd4] bg-[#fefdfa] shadow-none">
      <div className="px-4 pb-4 pt-5">
        {/* 新建对话只影响当前聊天上下文，不会触发认证动作 */}
        <Button
          variant="default"
          className="w-full justify-center rounded-full border-none bg-transparent text-slate-600 shadow-none transition-colors duration-200 hover:translate-y-0 hover:bg-[#dde3ec] hover:text-slate-800"
          onClick={onCreate}
        >
          <Plus className="h-4 w-4" />
          新建对话
        </Button>
      </div>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-2">
          {conversations.map((conversation) => {
            const isActive = conversation.conversation_id === activeConversationId;
            return (
              <div
                key={conversation.conversation_id}
                className={cn(
                  "group relative flex items-center gap-2 rounded-full pr-2 transition-colors duration-200",
                  isActive
                    ? "bg-[#d8e0ea] text-slate-800"
                    : "bg-transparent text-slate-700 hover:bg-[#e4e9f1] hover:text-slate-900"
                )}
              >
                {/* 2026-06-09 改造：去 <Link> 改 onClick + useNavigate
                    原因：<Link> 默认响应 onClick 抢走双击事件（双击=2 次单击+1 次双击）
                         导致双击进入编辑模式的同时 Link 触发 navigate →
                         路由参数变化 → useEffect cleanup → WebSocket 关闭
                    改后：ConversationTitleItem 内部可以正确处理双击（包括 input 失焦） */}
                <div
                  role="button"
                  tabIndex={0}
                  className="relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-3"
                  onClick={() => {
                    // === 2026-06-09 改造：只在不是当前路由时才 navigate
                    // 原因：双击会触发 2 次 onClick + 1 次 onDoubleClick；
                    //       如果 2 次 navigate 都跑，且当前已经在这个路由，会触发 React Router
                    //       内部 state 更新（即使 path 不变），导致 useEffect 重新执行 → WebSocket cleanup
                    // 改成只在 isActive = false 时 navigate
                    if (!isActive) {
                      navigate(ROUTES.chatConversation(conversation.conversation_id));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (!isActive) {
                        navigate(ROUTES.chatConversation(conversation.conversation_id));
                      }
                    }
                  }}
                >
                  <MessageSquareMore
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      isActive ? "text-slate-700" : "text-slate-600 group-hover:text-slate-800"
                    )}
                  />
                  <ConversationTitleItem
                    title={conversation.title}
                    isActive={isActive}
                    onSubmit={(newTitle) =>
                      onRename(conversation.conversation_id, newTitle)
                    }
                    onCancel={() => {
                      /* nothing to clean */
                    }}
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 shrink-0 rounded-full border-none bg-transparent opacity-0 transition-all group-hover:opacity-100",
                    isActive
                      ? "text-red-500 hover:bg-red-100/80 hover:text-red-600"
                      : "text-slate-400 hover:bg-red-100/80 hover:text-red-600"
                  )}
                  onClick={(event) => {
                    // 删除按钮：阻止冒泡到外层 div（避免触发导航）
                    event.preventDefault();
                    event.stopPropagation();
                    onDelete(conversation.conversation_id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          {!conversations.length && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">空</div>
          )}
        </div>
      </div>
      <Separator />
      <div className="flex items-center gap-2 p-3">
        {/* 左侧入口显示当前用户信息，并允许跳转到认证中心个人页 */}
        <a
          href={profileUrl}
          className="group flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border border-transparent bg-transparent px-3 text-left transition-all duration-300 hover:border-stone-400 hover:bg-transparent hover:shadow-[8px_8px_16px_rgba(201,197,190,0.35),-8px_-8px_16px_rgba(255,255,255,0.65)]"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-600 text-white transition-colors group-hover:bg-stone-700">
            <User2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-stone-700">
              {user?.username || "未登录"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.email || "点击重新认证"}
            </p>
          </div>
        </a>
        {/* 右侧按钮负责显式退出当前应用登录态 */}
        <Button
          variant="ghost"
          size="icon"
          className="h-12 w-12 shrink-0 border border-transparent bg-transparent text-red-500 transition-all duration-300 hover:border-red-300 hover:bg-red-100/90 hover:text-red-700 hover:shadow-[8px_8px_16px_rgba(201,197,190,0.35),-8px_-8px_16px_rgba(255,255,255,0.65)]"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
