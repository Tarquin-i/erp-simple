import {
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useRef, useState } from "react";

import { VersionConflictDialog } from "@/components/customers/version-conflict-dialog";
import { ProductForm, readProductDraft } from "@/components/products/form";
import {
  ProductPageError,
  ProductPagePending,
} from "@/components/products/load-state";
import {
  isSameProductEntry,
  productListOrigin,
} from "@/components/products/navigation";
import {
  productChanges,
  productDifferences,
  productFormIssue,
  rebaseProductEdit,
} from "@/components/products/save-state";
import type { ProductFormIssue } from "@/components/products/save-state";
import { toastManager } from "@/components/ui/toast";
import {
  getProduct,
  isProductSnapshot,
  ProductApiError,
  updateProduct,
} from "@/request/products";
import type {
  ProductDetailRecord,
  ProductWriteInput,
} from "@/request/products";

export const Route = createFileRoute("/_protected/products/$productId/edit")({
  loader: {
    staleReloadMode: "blocking",
    handler: ({ params, abortController }) =>
      getProduct(params.productId, abortController.signal),
  },
  pendingComponent: ProductPagePending,
  errorComponent: ProductPageError,
  component: EditProductPage,
});

type Conflict = { current: ProductDetailRecord; proposed: ProductDetailRecord };

function EditProductPage() {
  const { product } = Route.useLoaderData();
  return <EditProductSession key={product.id} product={product} />;
}

function EditProductSession({ product }: { product: ProductDetailRecord }) {
  const { state } = useLocation();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [base, setBase] = useState(product);
  const [draft, setDraft] = useState(() => readProductDraft(product));
  const [issue, setIssue] = useState<ProductFormIssue>();
  const [conflict, setConflict] = useState<Conflict>();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  function returnToDetail() {
    return navigate({
      to: "/products/$productId",
      params: { productId: product.id },
      state: productListOrigin(state),
      replace: true,
    });
  }

  function keepDraft(
    current: ProductDetailRecord,
    proposed: ProductDetailRecord
  ) {
    setBase(current);
    setDraft(readProductDraft(proposed));
    setConflict(undefined);
  }

  async function save(
    current: ProductDetailRecord,
    proposed: ProductWriteInput
  ) {
    if (submitting.current) return;
    const patch = productChanges(current, proposed);
    if (!Object.keys(patch).length) {
      await returnToDetail();
      return;
    }
    submitting.current = true;
    setPending(true);
    setIssue(undefined);
    const start = router.state.location;
    try {
      await updateProduct(current.id, current.version, patch);
      if (!isSameProductEntry(router.state.location, start)) return;
      toastManager.add({ title: "产品已保存" });
      await returnToDetail();
    } catch (failure) {
      if (!isSameProductEntry(router.state.location, start)) return;
      if (
        failure instanceof ProductApiError &&
        failure.code === "version_conflict" &&
        isProductSnapshot(failure.current, current.id)
      ) {
        const latest = failure.current;
        const rebased = rebaseProductEdit(latest, patch, proposed);
        if (!productDifferences(latest, rebased).length) {
          await returnToDetail();
          return;
        }
        setConflict({ current: latest, proposed: rebased });
        return;
      }
      if (conflict) keepDraft(conflict.current, conflict.proposed);
      setIssue(productFormIssue(failure));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <ProductForm
        title="编辑产品"
        draft={draft}
        customerLocked
        pending={pending}
        disabled={Boolean(conflict)}
        error={issue?.error}
        fieldError={issue?.fieldError}
        onDraftChange={(next) => {
          setDraft(next);
          setIssue(undefined);
        }}
        onSubmit={(input) => void save(base, input)}
        onCancel={() => void returnToDetail()}
      />
      <VersionConflictDialog
        differences={
          conflict
            ? productDifferences(conflict.current, conflict.proposed)
            : null
        }
        description="产品已被其他人更新。取消会保留你的修改，覆盖保存会提交下方列出的字段。"
        pending={pending}
        onCancel={() => {
          if (conflict) keepDraft(conflict.current, conflict.proposed);
        }}
        onOverwrite={() => {
          if (conflict) void save(conflict.current, conflict.proposed);
        }}
      />
    </>
  );
}
