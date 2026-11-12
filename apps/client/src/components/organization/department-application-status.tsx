import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";

interface DepartmentApplicationStatusProps {
  departmentName: string;
  busy: boolean;
  onRefresh: () => void;
}

export function DepartmentApplicationStatus({
  departmentName,
  busy,
  onRefresh,
}: DepartmentApplicationStatusProps) {
  return (
    <div className="space-y-4">
      <FieldDescription role="status" className="break-words">
        已提交加入{" "}
        <span className="font-medium text-foreground">{departmentName}</span>{" "}
        的申请，请等待该部门主管审批。
      </FieldDescription>
      <Button className="min-h-11 w-full" disabled={busy} onClick={onRefresh}>
        {busy ? "正在检查…" : "检查审批结果"}
      </Button>
    </div>
  );
}
