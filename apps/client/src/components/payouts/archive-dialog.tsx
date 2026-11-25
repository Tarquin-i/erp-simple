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
import { FieldError } from "@/components/ui/field";

export function PayoutArchiveDialog({
  open,
  name,
  hasDraft,
  pending,
  issue,
  retry,
  onClose,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  name: string;
  hasDraft: boolean;
  pending: boolean;
  issue?: string;
  retry: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => !next && !pending && onClose()}
    >
      <AlertDialogContent
        className="w-[calc(100%-2rem)] grid-cols-1"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>归档 Payout</AlertDialogTitle>
          <AlertDialogDescription className="min-w-0 wrap-anywhere">
            「{name}」归档后将从列表移除，已保存的资料会保留。
            {hasDraft && " 当前奖项草稿会丢失。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldError>{issue}</FieldError>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "正在归档…" : retry ? "重试归档" : "确认归档"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
