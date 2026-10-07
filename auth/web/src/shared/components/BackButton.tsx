import { ArrowLeft, Home } from "lucide-react";
import type { MouseEventHandler, ReactNode } from "react";
import { cn } from "@/shared/libs/utils";

// 立体感（neumorphism）返回 / 首页按钮：
// - 默认显示在页面左上角 fixed 位置，方便所有"用户相关配置"页统一调用
// - 颜色与项目其它面板（#e8e4df / #f0ece6 / stone-*）保持一致
// - 使用 6px 双向阴影模拟凸起，hover 时阴影更深、轻微下沉，提供反馈
// - 高度 h-12 + 14px 文字，与登录卡片主按钮量级一致，避免"太小看不到"
interface BackButtonProps {
  onClick: MouseEventHandler<HTMLButtonElement>;
  label?: string;
  icon?: ReactNode;
  // 默认 fixed 在左上角；若放在容器内（如 header 行内）传 inline
  variant?: "fixed-left" | "fixed-right" | "inline";
  className?: string;
  title?: string;
}

export function BackButton({
  onClick,
  label = "返回",
  icon,
  variant = "fixed-left",
  className,
  title,
}: BackButtonProps) {
  const positionClass =
    variant === "fixed-left"
      ? "fixed left-4 top-4 z-50"
      : variant === "fixed-right"
        ? "fixed right-4 top-4 z-50"
        : "";

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      className={cn(
        positionClass,
        // 立体感主按钮样式：浅米色面板 + 双向阴影 + hover 反馈
        "inline-flex items-center gap-2 rounded-2xl bg-[#f0ece6] px-5 h-12 text-sm font-medium text-stone-700",
        "border border-stone-300/60",
        "shadow-[6px_6px_14px_#c9c5be,-6px_-6px_14px_#ffffff]",
        "transition-all duration-200",
        "hover:shadow-[3px_3px_8px_#c9c5be,-3px_-3px_8px_#ffffff] hover:translate-y-[1px] hover:text-stone-900",
        "active:shadow-[inset_4px_4px_8px_#c9c5be,inset_-4px_-4px_8px_#ffffff]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-500/40",
        className
      )}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-[#e8e4df] shadow-[inset_2px_2px_4px_#c9c5be,inset_-2px_-2px_4px_#ffffff]">
        {icon ?? <ArrowLeft className="h-4 w-4 text-stone-700" />}
      </span>
      <span>{label}</span>
    </button>
  );
}

// 语义化便捷封装：直接给"返回首页 / 平台中心"用
export function HomeButton(props: Omit<BackButtonProps, "icon" | "label"> & { label?: string }) {
  return (
    <BackButton
      {...props}
      label={props.label ?? "首页"}
      icon={<Home className="h-4 w-4 text-stone-700" />}
    />
  );
}
