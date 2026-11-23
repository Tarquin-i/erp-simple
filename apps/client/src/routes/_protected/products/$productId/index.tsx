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
import { isSameProductEntry } from "@/components/products/navigation";
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
import { toastManager } from "@/components/ui/toast";
import {
  archiveProduct,
  getProduct,
  isProductSnapshot,
  ProductApiError,
} from "@/request/products";
import type { ProductDetailRecord } from "@/request/products";

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
  const archiving = useRef(false);
  const current = latest && latest.version > product.version ? latest : product;
  const productListQuery = state.productListQuery;

  function returnToList() {
    return navigate({
      to: "/products",
      search: productListQuery ?? {},
      replace: true,
    });
  }

  async function confirmArchive() {
    if (archiving.current) return;
    archiving.current = true;
    setPending(true);
    setIssue("");
    const start = router.state.location;
    try {
      await archiveProduct(current.id, current.version);
      if (!isSameProductEntry(router.state.location, start)) return;
      setConfirmOpen(false);
      toastManager.add({ title: "产品已归档" });
      await returnToList();
    } catch (failure) {
      if (!isSameProductEntry(router.state.location, start)) return;
      if (failure instanceof ProductApiError) {
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
      } else {
        setIssue("暂时无法确认归档结果，请重试。");
      }
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
              state={{ productListQuery }}
              preload={false}
              replace
            >
              <Pencil aria-hidden="true" />
              编辑
            </Link>
          </Button>
        }
        onArchive={() => {
          setIssue("");
          setConfirmOpen(true);
        }}
      />
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!archiving.current) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>归档产品</AlertDialogTitle>
            <AlertDialogDescription>
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
              {pending ? "正在归档…" : "确认归档"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
