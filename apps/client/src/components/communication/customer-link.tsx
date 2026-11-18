import { Link } from "@tanstack/react-router";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function CommunicationCustomerLink({
  customer,
  showNumber = false,
  className = "wrap-anywhere underline-offset-4 hover:underline",
}: {
  customer?: { id: string; companyName: string; customerNo?: string } | null;
  showNumber?: boolean;
  className?: string;
}) {
  if (customer) {
    return (
      <Link
        to="/customers/$customerId"
        params={{ customerId: customer.id }}
        className={className}
      >
        {customer.companyName}
        {showNumber && customer.customerNo && (
          <span className="ml-2 text-muted-foreground">
            {customer.customerNo}
          </span>
        )}
      </Link>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="link"
          className="h-auto px-0 text-muted-foreground"
        >
          客户信息受限
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>没有权限查看客户</AlertDialogTitle>
          <AlertDialogDescription>
            你可以继续查看和编辑这条沟通记录。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>知道了</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
