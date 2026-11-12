export function PendingModule({ title }: { title: string }) {
  return (
    <section className="mx-auto w-full max-w-5xl space-y-3 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">待开发</p>
    </section>
  );
}
