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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Difference = { label: string; current: string; proposed: string };

/**
 * 展示服务端当前值和用户拟提交值，等待用户取消或确认覆盖。
 * @param props 对比行、提交状态以及取消和覆盖回调。`differences` 为 `null` 时关闭弹窗。
 * @returns 由调用方控制开关和异步提交状态的确认弹窗。
 */
export function VersionConflictDialog({
  differences,
  pending = false,
  onCancel,
  onOverwrite,
}: {
  differences: Difference[] | null;
  pending?: boolean;
  onCancel: () => void;
  onOverwrite: () => void;
}) {
  return (
    <AlertDialog
      open={differences !== null}
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <AlertDialogContent className="max-h-[85vh] overflow-auto data-[size=default]:max-w-[calc(100%-2rem)] sm:data-[size=default]:max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>资料已被更新</AlertDialogTitle>
          <AlertDialogDescription>
            比较当前资料和你的修改。确认覆盖后，只保存你提交的字段。
          </AlertDialogDescription>
        </AlertDialogHeader>
        {differences?.length ? (
          <div className="max-h-[45vh] overflow-auto rounded-lg border">
            <Table className="table-fixed">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-1/5 whitespace-normal">
                    字段
                  </TableHead>
                  <TableHead>当前资料</TableHead>
                  <TableHead>你的修改</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {differences.map(({ label, current, proposed }) => (
                  <TableRow key={label}>
                    <TableCell className="align-top font-medium whitespace-normal">
                      {label}
                    </TableCell>
                    <TableCell className="align-top wrap-anywhere whitespace-pre-wrap text-muted-foreground">
                      {current || "—"}
                    </TableCell>
                    <TableCell className="align-top wrap-anywhere whitespace-pre-wrap">
                      {proposed || "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              // 保持弹窗打开，由调用方在异步覆盖完成后更新弹窗状态。
              event.preventDefault();
              onOverwrite();
            }}
          >
            {pending ? "正在保存…" : "覆盖保存"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
