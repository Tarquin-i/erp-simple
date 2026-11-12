import { createFileRoute } from "@tanstack/react-router";

import { PendingModule } from "@/components/layout/pending-module";

export const Route = createFileRoute("/_protected/customers/")({
  component: () => <PendingModule title="客户" />,
});
