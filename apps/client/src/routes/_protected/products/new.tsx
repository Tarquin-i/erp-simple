import {
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useRef, useState } from "react";

import { ProductForm, readProductDraft } from "@/components/products/form";
import {
  isSameProductEntry,
  productListOrigin,
} from "@/components/products/navigation";
import { productFormIssue } from "@/components/products/save-state";
import type { ProductFormIssue } from "@/components/products/save-state";
import { toastManager } from "@/components/ui/toast";
import { createUuid } from "@/lib/uuid";
import { createProduct, ProductApiError } from "@/request/products";
import type { ProductCreateInput } from "@/request/products";

export const Route = createFileRoute("/_protected/products/new")({
  component: NewProductPage,
});

type Submission = { id: string; input: ProductCreateInput };

function NewProductPage() {
  const { viewer } = Route.useRouteContext();
  return <NewProductSession key={viewer.account.id} />;
}

function NewProductSession() {
  const { state } = useLocation();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [draft, setDraft] = useState(readProductDraft);
  const [issue, setIssue] = useState<ProductFormIssue>();
  const [retry, setRetry] = useState<Submission>();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const productListQuery = state.productListQuery;

  async function save(input: ProductCreateInput) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setIssue(undefined);
    const start = router.state.location;
    const submission = retry ?? { id: createUuid(), input };
    try {
      const { product } = await createProduct(submission.input, submission.id);
      if (!isSameProductEntry(router.state.location, start)) return;
      setRetry(undefined);
      toastManager.add({ title: "产品已新建" });
      await navigate({
        to: "/products/$productId",
        params: { productId: product.id },
        state: productListOrigin(state),
        replace: true,
      });
    } catch (failure) {
      if (!isSameProductEntry(router.state.location, start)) return;
      if (
        !(failure instanceof ProductApiError) ||
        failure.status >= 500 ||
        failure.status === 408 ||
        failure.status === 429
      ) {
        setRetry(submission);
        setIssue({ error: "暂时无法确认保存结果，请重试原提交。" });
        return;
      }
      setRetry(undefined);
      setIssue(productFormIssue(failure));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <ProductForm
      title="新建产品"
      draft={draft}
      fieldsLocked={Boolean(retry)}
      saveLabel={retry ? "重试保存" : undefined}
      pending={pending}
      error={issue?.error}
      fieldError={issue?.fieldError}
      onDraftChange={(next) => {
        setDraft(next);
        setIssue(undefined);
      }}
      onSubmit={(input) => void save(input)}
      onCancel={() =>
        void navigate({
          to: "/products",
          search: productListQuery ?? {},
          replace: true,
        })
      }
    />
  );
}
