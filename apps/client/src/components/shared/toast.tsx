import { Toast } from "@base-ui/react/toast";
import { Check, CircleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export const toastManager = Toast.createToastManager();

function ToastMessages() {
  const { toasts } = Toast.useToastManager();

  return (
    <Toast.Portal>
      <Toast.Viewport
        aria-label="通知"
        className="pointer-events-none fixed right-4 bottom-4 left-4 z-100001 flex max-h-[calc(100dvh-2rem)] flex-col-reverse gap-2 overflow-x-hidden overflow-y-auto p-1 sm:left-auto sm:w-80"
      >
        {toasts.map((toast) => (
          <Toast.Root
            key={toast.id}
            toast={toast}
            className="group/toast flex shrink-0 items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring data-[type=error]:border-destructive data-[type=error]:bg-destructive data-[type=error]:text-background motion-safe:transition-[translate,opacity] motion-safe:duration-350 motion-safe:ease-out motion-safe:data-starting-style:translate-x-full motion-safe:data-starting-style:opacity-0 motion-safe:data-ending-style:translate-x-full motion-safe:data-ending-style:opacity-0 motion-safe:data-ending-style:ease-in"
          >
            {toast.type === "error" ? (
              <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <Check aria-hidden="true" className="size-4 shrink-0" />
            )}
            <Toast.Title className="min-w-0 flex-1 text-sm font-medium" />
            <Toast.Close
              aria-label="关闭通知"
              aria-hidden={false}
              className="pointer-events-auto group-data-[type=error]/toast:hover:bg-current/10 group-data-[type=error]/toast:hover:text-inherit group-data-[type=error]/toast:focus-visible:ring-current"
              render={<Button type="button" variant="ghost" size="icon-xs" />}
            >
              <X aria-hidden="true" />
            </Toast.Close>
          </Toast.Root>
        ))}
      </Toast.Viewport>
    </Toast.Portal>
  );
}

export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager} timeout={3000} limit={Infinity}>
      <ToastMessages />
    </Toast.Provider>
  );
}
