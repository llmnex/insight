import { useState, useRef, useEffect, useCallback } from "react";
import { Check, X, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversationTitleItemProps {
  title: string;
  isActive: boolean;
  onSubmit: (newTitle: string) => Promise<void>;
  onCancel: () => void;
}

export function ConversationTitleItem({
  title,
  isActive,
  onSubmit,
  onCancel,
}: ConversationTitleItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(title);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    if (clickTimerRef.current) {
      // 第二次点击（在 300ms 内）→ 判定为双击
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      e.preventDefault();
      e.stopPropagation();
      setEditingTitle(title);
      setIsEditing(true);
      return;
    }
    // 第一次点击：什么都不做（300ms 内没第二次点击 → 让外层 ChatSidebar 的 onClick 处理 navigate）
    // 不 stopPropagation，**让事件冒泡到外层**让 navigate 正常触发
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
    }, 300);
  };

  const handleSubmit = useCallback(async () => {
    if (submittingRef.current) return;
    const trimmed = editingTitle.trim();
    if (!trimmed) {
      setIsEditing(false);
      onCancel();
      return;
    }
    if (trimmed === title) {
      setIsEditing(false);
      return;
    }
    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await onSubmit(trimmed);
      setIsEditing(false);
    } catch (e) {
      setEditingTitle(title);
      setIsEditing(false);
      console.error("重命名失败:", e);
    } finally {
      setIsSubmitting(false);
      submittingRef.current = false;
    }
  }, [editingTitle, title, onSubmit, onCancel]);

  const handleCancel = () => {
    setEditingTitle(title);
    setIsEditing(false);
    onCancel();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div
        className="flex min-w-0 flex-1 items-center gap-1"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={editingTitle}
          onChange={(e) => setEditingTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSubmit}
          // === 2026-06-09 新增：阻止 input 内部 click/mousedown 冒泡到外层 div
          // 原因：外层 ChatSidebar 仍保留 onClick={navigate}（深嵌套结构）
          //       input 内部的 click 会冒泡触发 navigate → 路由变化 → WebSocket 重建
          //       用户在 input 里改字时，路由不应该变
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          // === 新增结束 ===
          maxLength={128}
          disabled={isSubmitting}
          className={cn(
            "min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-0.5 text-sm font-medium text-slate-800 outline-none focus:border-slate-500",
            isSubmitting && "opacity-60"
          )}
        />
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void handleSubmit();
          }}
          disabled={isSubmitting}
          className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
          title="保存"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleCancel();
          }}
          disabled={isSubmitting}
          className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
          title="取消"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1.5"
      onClick={handleClick}
    >
      <span
        className={cn(
          "line-clamp-1 min-w-0 text-sm font-medium transition-colors",
          isActive ? "text-slate-800" : "text-slate-700 group-hover:text-slate-900"
        )}
        title={`${title}（双击可修改）`}
      >
        {title || "新对话"}
      </span>
      <Pencil
        className={cn(
          "h-3 w-3 shrink-0 transition-opacity",
          isActive ? "text-slate-500" : "text-slate-400",
          "opacity-0 group-hover:opacity-100"
        )}
        aria-hidden
      />
    </div>
  );
}
