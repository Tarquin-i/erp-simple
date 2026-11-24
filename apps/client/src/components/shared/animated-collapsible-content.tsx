import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { CollapsibleContent } from "@/components/ui/collapsible";

export function AnimatedCollapsibleContent({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(
    open ? undefined : 0
  );

  useLayoutEffect(() => {
    const element = body.current;
    if (!open || !element) return;

    // 观察内容的自然高度，详情加载完成后也能平滑调整。
    const measure = () => setHeight(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open]);

  return (
    <CollapsibleContent forceMount inert={!open}>
      <div
        className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
        style={{ height: open ? height : 0 }}
      >
        <div ref={body}>{children}</div>
      </div>
    </CollapsibleContent>
  );
}
