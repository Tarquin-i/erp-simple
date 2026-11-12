import { createFileRoute } from "@tanstack/react-router";

import { PendingModule } from "@/components/layout/pending-module";

export const Route = createFileRoute("/_protected/payouts/")({
  component: () => <PendingModule title="Payout" />,
});
