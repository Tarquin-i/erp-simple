import { createFileRoute } from "@tanstack/react-router";

import { EmailPasswordForm } from "@/components/auth/email-password-form";

export const Route = createFileRoute("/_auth/login/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <EmailPasswordForm mode="login" />;
}
