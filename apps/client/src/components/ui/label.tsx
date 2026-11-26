import type * as React from "react";
import { cn } from "cn";
import { Label as LabelPrimitive } from "radix-ui";

function Label({
  className,
  preventControlActivation,
  onClick,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & {
  preventControlActivation?: boolean;
}) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        // 原生标签会把鼠标悬浮状态传给关联控件。
        preventControlActivation && "pointer-events-none",
        className
      )}
      onClick={
        preventControlActivation
          ? (event) => {
              // 保留字段名关联，同时避免标题替下拉触发器执行点击。
              event.preventDefault();
              onClick?.(event);
            }
          : onClick
      }
      {...props}
    />
  );
}

export { Label };
