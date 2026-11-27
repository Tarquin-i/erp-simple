import { useRouter } from "@tanstack/react-router";
import { Archive } from "lucide-react";
import { useRef, useState } from "react";

import { isSameProductEntry } from "@/components/products/navigation";
import { toastManager } from "@/components/shared/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { archiveCustomer, CustomerApiError } from "@/request/customers";
import type { Customer } from "@/request/customers";

export function CustomerArchiveAction({
  customer,
  onArchived,
}: {
  customer: Customer;
  onArchived: () => void;
}) {
  const router = useRouter();
  const trigger = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [target, setTarget] = useState<Customer>();
  const [pending, setPending] = useState(false);
  const [retry, setRetry] = useState(false);
  const [issue, setIssue] = useState("");

  async function confirm() {
    if (!target || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setIssue("");
    const start = router.state.location;
    try {
      await archiveCustomer(target.id, target.version);
      if (!isSameProductEntry(router.state.location, start)) return;
      setTarget(undefined);
      toastManager.add({ title: "客户已归档" });
      onArchived();
    } catch (error) {
      if (!isSameProductEntry(router.state.location, start)) return;
      if (
        !(error instanceof CustomerApiError) ||
        error.status >= 500 ||
        error.status === 408 ||
        error.status === 429
      ) {
        setRetry(true);
        setIssue("暂时无法确认归档结果，请重试。");
      } else if (error.code === "version_conflict") {
        setTarget(undefined);
        toastManager.add({
          title: "客户资料已更新，请核对后重新确认归档。",
          type: "error",
        });
        void router.invalidate();
      } else if (error.status === 404) {
        setTarget(undefined);
        toastManager.add({ title: "该客户已不可查看", type: "error" });
        onArchived();
      } else {
        setRetry(false);
        setIssue(error.message);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Button
        ref={trigger}
        type="button"
        variant="destructive"
        aria-haspopup="dialog"
        onClick={() => {
          setIssue("");
          setRetry(false);
          setTarget(customer);
        }}
      >
        <Archive data-icon="inline-start" />
        归档
      </Button>
      <AlertDialog
        open={Boolean(target)}
        onOpenChange={(open) => {
          if (!open && !pending) setTarget(undefined);
        }}
      >
        <AlertDialogContent
          className="w-[calc(100%-2rem)] grid-cols-1"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>归档客户</AlertDialogTitle>
            <AlertDialogDescription className="min-w-0 wrap-anywhere">
              「{target?.companyName}
              」及其地址、联系人将一并归档。历史沟通仍可查看。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldError>{issue}</FieldError>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              {pending ? "正在归档…" : retry ? "重试归档" : "确认归档"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
