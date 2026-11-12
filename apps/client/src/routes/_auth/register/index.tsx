import { createFileRoute } from "@tanstack/react-router";

import { EmailPasswordForm } from "@/components/auth/email-password-form";

export const Route = createFileRoute("/_auth/register/")({
  component: RouteComponent,
});

function RouteComponent() {
  return <EmailPasswordForm mode="register" />;
}
