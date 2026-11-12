import { createFileRoute } from "@tanstack/react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_protected/")({ component: Home });

function Home() {
  const { viewer } = Route.useRouteContext();

  return (
    <section
      aria-labelledby="workspace-heading"
      className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10"
    >
      <h1
        id="workspace-heading"
        className="text-3xl font-semibold tracking-tight"
      >
        工作台
      </h1>
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>
            <h2>当前账号</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="break-all text-muted-foreground">
            {viewer.account.email}
          </p>
          <p className="text-sm">{viewer.department?.name ?? "公司管理员"}</p>
        </CardContent>
      </Card>
    </section>
  );
}
