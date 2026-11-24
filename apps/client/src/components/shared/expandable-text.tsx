import {
  type TransitionEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";

export function ExpandableText({ text }: { text: string }) {
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const [heights, setHeights] = useState<{
    full: number;
    preview: number;
  }>();

  useLayoutEffect(() => {
    const element = paragraph.current;
    if (!element) return;

    const measure = () => {
      const full = element.scrollHeight;
      const lineHeight = Number.parseFloat(
        getComputedStyle(element).lineHeight
      );
      const preview = Math.min(full, lineHeight * 3);
      setHeights((previous) =>
        previous?.full === full && previous.preview === preview
          ? previous
          : { full, preview }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  const canExpand = heights !== undefined && heights.full > heights.preview + 1;
  const height = expanded ? heights?.full : heights?.preview;

  function toggle() {
    const element = viewport.current;
    // 收起过程中保留全文，让文字随区域高度逐行收回。
    setClosing(
      expanded &&
        !!element &&
        !!heights &&
        element.getBoundingClientRect().height > heights.preview + 1 &&
        getComputedStyle(element).transitionProperty !== "none"
    );
    setExpanded(!expanded);
  }

  function finishClosing(event: TransitionEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    if (
      closing &&
      event.target === element &&
      event.propertyName === "height" &&
      heights &&
      (element.getBoundingClientRect().height <= heights.preview + 1 ||
        getComputedStyle(element).transitionProperty === "none")
    ) {
      setClosing(false);
    }
  }

  return (
    <>
      <div
        ref={viewport}
        id={id}
        className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
        style={{ height }}
        onTransitionEnd={finishClosing}
        onTransitionCancel={finishClosing}
      >
        <p
          ref={paragraph}
          className={`leading-6 whitespace-pre-wrap wrap-anywhere${expanded || closing ? "" : " line-clamp-3"}`}
        >
          {text}
        </p>
      </div>
      {(canExpand || expanded) && (
        <Button
          type="button"
          variant="link"
          className="mt-1 h-auto px-0"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      )}
    </>
  );
}
