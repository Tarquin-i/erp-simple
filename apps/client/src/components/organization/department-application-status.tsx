import { Button } from "@/components/ui/button";

interface DepartmentApplicationStatusProps {
  departmentName: string;
  busy: boolean;
  checked: boolean;
  onRefresh: () => void;
}

export function DepartmentApplicationStatus({
  departmentName,
  busy,
  checked,
  onRefresh,
}: DepartmentApplicationStatusProps) {
  return (
    <div className="space-y-4">
      <div
        className="space-y-2 rounded-lg border bg-muted/40 p-3"
        role="status"
      >
        <dl>
          <dt className="text-xs text-muted-foreground">申请部门</dt>
          <dd className="mt-1 font-medium [overflow-wrap:anywhere]">
            {departmentName}
          </dd>
        </dl>
        <p className="text-sm text-muted-foreground">
          {checked ? "申请仍在等待审批。" : "审批通过后即可进入工作台。"}
        </p>
      </div>
      <Button
        type="button"
        className="min-h-11 w-full"
        aria-busy={busy}
        disabled={busy}
        onClick={onRefresh}
      >
        {busy ? "正在检查…" : "检查审批结果"}
      </Button>
    </div>
  );
}
