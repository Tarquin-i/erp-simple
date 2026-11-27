import { Save } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";

import { toastManager } from "@/components/shared/toast";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createUuid } from "@/lib/uuid";
import { createPayout, PayoutApiError } from "@/request/payouts";

import { PayoutProductPicker } from "./product-picker";
import type { PayoutProductChoice } from "./product-picker";

type Submission = {
  id: string;
  input: Parameters<typeof createPayout>[0];
};

export function CreatePayoutForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [product, setProduct] = useState<PayoutProductChoice | null>(null);
  const [name, setName] = useState("");
  const [count, setCount] = useState("");
  const [price, setPrice] = useState("");
  const [remark, setRemark] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<Submission>();
  const submitting = useRef(false);
  const mounted = useRef(false);
  const disabled = busy || Boolean(retry);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const ticketCount = Number(count.trim());
    const unitPrice = price.trim();
    const payoutName = name.trim();
    if (!product) {
      setError("请选择产品。");
      return;
    }
    if (!payoutName) {
      setError("请填写 Payout 名称。");
      return;
    }
    if (
      !/^\d+$/u.test(count.trim()) ||
      ticketCount < 1 ||
      ticketCount > 1_000_000
    ) {
      setError("总张数须为 1 至 1000000 的整数。");
      return;
    }
    if (
      unitPrice &&
      (!/^\d+(?:\.\d{1,4})?$/u.test(unitPrice) ||
        Number(unitPrice) <= 0 ||
        Number(unitPrice) > 100_000)
    ) {
      setError("每张票面售价须大于 0、不超过 100000，最多保留 4 位小数。");
      return;
    }

    const submission = retry ?? {
      id: createUuid(),
      input: {
        productId: product.id,
        ticketCount,
        name: payoutName,
        unitPrice: unitPrice || undefined,
        remark: remark.trim() || undefined,
      },
    };
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const { payout } = await createPayout(submission.input, submission.id);
      if (mounted.current) {
        toastManager.add({ title: "Payout 已新建" });
        onCreated(payout.id);
      }
    } catch (failure: unknown) {
      if (!mounted.current) return;
      if (
        !(failure instanceof PayoutApiError) ||
        failure.status >= 500 ||
        failure.status === 408 ||
        failure.status === 429
      ) {
        setRetry(submission);
        setError("暂时无法确认保存结果，请重试原提交。");
      } else {
        setRetry(undefined);
        setError(failure.message);
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function changeField(setValue: (value: string) => void, value: string) {
    setValue(value);
    setError("");
  }

  return (
    <main className="min-w-0 flex-1 bg-background px-5 py-6 sm:px-7 lg:px-8">
      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">新建 Payout</h1>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-10 px-4"
              disabled={busy}
              onClick={onCancel}
            >
              取消
            </Button>
            <Button
              type="submit"
              className="h-10 px-4"
              disabled={busy}
              aria-busy={busy}
            >
              <Save aria-hidden="true" />
              {busy ? "正在保存…" : retry ? "重试保存" : "保存"}
            </Button>
          </div>
        </header>
        {error && (
          <p
            role="alert"
            className="wrap-break-word rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${id}-product`} preventControlActivation>
              产品
            </FieldLabel>
            <PayoutProductPicker
              id={`${id}-product`}
              value={product}
              disabled={disabled}
              required
              onChange={(selected) => {
                setProduct(selected);
                setError("");
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>Payout 名称</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              required
              maxLength={128}
              disabled={disabled}
              onChange={(event) => changeField(setName, event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-count`}>总张数</FieldLabel>
            <Input
              id={`${id}-count`}
              value={count}
              inputMode="numeric"
              required
              maxLength={7}
              disabled={disabled}
              onChange={(event) => changeField(setCount, event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-price`}>
              每张票面售价{product ? `（${product.currencyCode}）` : ""}
            </FieldLabel>
            <Input
              id={`${id}-price`}
              value={price}
              inputMode="decimal"
              placeholder="1"
              maxLength={12}
              disabled={disabled}
              onChange={(event) => changeField(setPrice, event.target.value)}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor={`${id}-remark`}>备注</FieldLabel>
            <Textarea
              id={`${id}-remark`}
              value={remark}
              maxLength={2000}
              disabled={disabled}
              onChange={(event) => changeField(setRemark, event.target.value)}
            />
          </Field>
        </div>
      </form>
    </main>
  );
}
