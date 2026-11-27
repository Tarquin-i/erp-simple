import {
  createFileRoute,
  Link,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useRef, useState } from "react";

import { ProductDetail } from "@/components/products/detail";
import {
  ProductPageError,
  ProductPagePending,
} from "@/components/products/load-state";
import {
  isSameProductEntry,
  productListDestination,
  productListOrigin,
  replaceProductEntryAndGoBack,
} from "@/components/products/navigation";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { toastManager } from "@/components/shared/toast";
import {
  archiveProduct,
  getProduct,
  isProductSnapshot,
  ProductApiError,
} from "@/request/products";
import type { ProductDetailRecord } from "@/request/products";

const unconfirmedArchive = "暂时无法确认归档结果，请重试。";

export const Route = createFileRoute("/_protected/products/$productId/")({
  loader: {
    staleReloadMode: "blocking",
    handler: ({ params, abortController }) =>
      getProduct(params.productId, abortController.signal),
  },
  pendingComponent: ProductPagePending,
  errorComponent: ProductPageError,
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const { product } = Route.useLoaderData();
  return <ProductWorkspace key={product.id} product={product} />;
}

function ProductWorkspace({ product }: { product: ProductDetailRecord }) {
  const navigate = Route.useNavigate();
  const router = useRouter();
  const { state } = useLocation();
  const [latest, setLatest] = useState<ProductDetailRecord>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [issue, setIssue] = useState("");
  const [retryVersion, setRetryVersion] = useState<number>();
  const archiving = useRef(false);
  const current = latest && latest.version > product.version ? latest : product;
  function returnToList() {
    const destination = productListDestination(state);
    if (
      state.productListEntryIndex === state.__TSR_index - 1 &&
      router.history.canGoBack()
    ) {
      const { publicHref } = router.buildLocation(destination);
      replaceProductEntryAndGoBack(router.history, publicHref);
      return;
    }
    return navigate({ ...destination, replace: true });
  }

  async function confirmArchive() {
    if (archiving.current) return;
    archiving.current = true;
    setPending(true);
    setIssue("");
    const start = router.state.location;
    const expectedVersion = retryVersion ?? current.version;
    try {
      await archiveProduct(current.id, expectedVersion);
      if (!isSameProductEntry(router.state.location, start)) return;
      setConfirmOpen(false);
      toastManager.add({ title: "产品已归档" });
      await returnToList();
    } catch (failure) {
      if (!isSameProductEntry(router.state.location, start)) return;
      if (
        !(failure instanceof ProductApiError) ||
        failure.status >= 500 ||
        failure.status === 408 ||
        failure.status === 429
      ) {
        setRetryVersion(expectedVersion);
        setIssue(unconfirmedArchive);
        return;
      }
      setRetryVersion(undefined);
      if (
        failure.code === "version_conflict" &&
        isProductSnapshot(failure.current, current.id)
      ) {
        setLatest(failure.current);
        setIssue("产品资料有更新，请核对最新资料后再确认归档。");
        return;
      }
      if (failure.status === 404) {
        setConfirmOpen(false);
        toastManager.add({ title: "该产品已不可查看", type: "error" });
        await returnToList();
        return;
      }
      setIssue(failure.message);
    } finally {
      archiving.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <ProductDetail
        product={current}
        editAction={
          <Button asChild>
            <Link
              to="/products/$productId/edit"
              params={{ productId: current.id }}
              state={productListOrigin(state)}
              preload={false}
              replace
            >
              <Pencil data-icon="inline-start" />
              编辑
            </Link>
          </Button>
        }
        onArchive={() => {
          setIssue(retryVersion === undefined ? "" : unconfirmedArchive);
          setConfirmOpen(true);
        }}
      />
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!archiving.current) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent className="w-[calc(100%-2rem)] grid-cols-1">
          <AlertDialogHeader>
            <AlertDialogTitle>归档产品</AlertDialogTitle>
            <AlertDialogDescription className="min-w-0 wrap-anywhere">
              「{current.name}」归档后将从产品列表移除，原资料仍会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {issue && <FieldError>{issue}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void confirmArchive();
              }}
            >
              {pending
                ? "正在归档…"
                : retryVersion === undefined
                  ? "确认归档"
                  : "重试归档"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
