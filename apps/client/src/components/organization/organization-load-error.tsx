import { useRouter } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

export function OrganizationLoadError({ title }: { title: string }) {
  const router = useRouter();
  return (
    <section className="mx-auto w-full max-w-5xl space-y-3 px-6 py-10">
      <h1 className="text-xl font-semibold">{title}</h1>
      <Button variant="outline" onClick={() => void router.invalidate()}>
        重试
      </Button>
    </section>
  );
}
