"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Tabs as TabsPrimitive } from "radix-ui";

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function TabsList({
  animatedIndicator = false,
  children,
  className,
  ref,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants> & { animatedIndicator?: boolean }) {
  const listRef = React.useRef<HTMLDivElement>(null);
  const indicatorRef = React.useRef<HTMLSpanElement>(null);
  const animated = animatedIndicator && variant === "default" && !props.asChild;

  React.useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(
    ref,
    () => listRef.current
  );

  React.useLayoutEffect(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    if (!animated || !list || !indicator) return;

    const update = () => {
      const active = list.querySelector<HTMLElement>(
        ':scope > [data-slot="tabs-trigger"][data-state="active"]'
      );
      if (!active) {
        delete list.dataset.animatedIndicator;
        return;
      }

      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.height = `${active.offsetHeight}px`;
      indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
      if (!list.hasAttribute("data-animated-indicator")) {
        // 首次定位直接落在当前页签上。
        indicator.getBoundingClientRect();
        list.dataset.animatedIndicator = "true";
      }
    };

    const resize = new ResizeObserver(update);
    const observeTabs = () => {
      resize.disconnect();
      resize.observe(list);
      for (const tab of list.querySelectorAll(
        ':scope > [data-slot="tabs-trigger"]'
      )) {
        resize.observe(tab);
      }
    };
    const mutations = new MutationObserver((records) => {
      if (records.some(({ type }) => type === "childList")) observeTabs();
      update();
    });

    update();
    observeTabs();
    mutations.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    return () => {
      resize.disconnect();
      mutations.disconnect();
      delete list.dataset.animatedIndicator;
    };
  }, [animated]);

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(
        tabsListVariants({ variant }),
        animated &&
          "relative isolate data-animated-indicator:*:data-[slot=tabs-trigger]:z-10 data-animated-indicator:[&>[data-slot=tabs-trigger][data-state=active]]:bg-transparent data-animated-indicator:[&>[data-slot=tabs-trigger][data-state=active]]:shadow-none dark:data-animated-indicator:[&>[data-slot=tabs-trigger][data-state=active]]:border-transparent",
        className
      )}
      {...props}
    >
      {animated ? (
        <>
          {children}
          <span
            ref={indicatorRef}
            aria-hidden="true"
            data-slot="tabs-indicator"
            className="pointer-events-none invisible absolute top-0 left-0 rounded-md border border-transparent bg-background shadow-sm group-data-animated-indicator/tabs-list:visible motion-safe:group-data-animated-indicator/tabs-list:transition-[transform,width,height] motion-safe:duration-150 motion-safe:ease-out dark:border-input dark:bg-input/30"
          />
        </>
      ) : (
        children
      )}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:-bottom-1.25 group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
