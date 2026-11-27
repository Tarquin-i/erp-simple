import {
  createFileRoute,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { useRef, useState } from "react";

import type { CustomerChoice } from "@/components/shared/customer-select-field";
import { ProductForm, readProductDraft } from "@/components/products/form";
import {
  ProductFormPending,
  ProductPageError,
} from "@/components/products/load-state";
import {
  isSameProductEntry,
  productListDestination,
  productListOrigin,
  readNewProductSearch,
  replaceProductEntryAndGoBack,
} from "@/components/products/navigation";
import { productFormIssue } from "@/components/products/save-state";
import type { ProductFormIssue } from "@/components/products/save-state";
import { toastManager } from "@/components/shared/toast";
import { createUuid } from "@/lib/uuid";
import { getCustomer } from "@/request/customers";
import { createProduct, ProductApiError } from "@/request/products";
import type { ProductCreateInput } from "@/request/products";

export const Route = createFileRoute("/_protected/products/new")({
  validateSearch: readNewProductSearch,
  loaderDeps: ({ search: { customerId } }) => ({ customerId }),
  loader: ({ deps: { customerId }, abortController }) =>
    customerId ? getCustomer(customerId, abortController.signal) : undefined,
  pendingComponent: ProductFormPending,
  errorComponent: ProductPageError,
  component: NewProductPage,
});

type Submission = { id: string; input: ProductCreateInput };

function NewProductPage() {
  const { viewer } = Route.useRouteContext();
  const customer = Route.useLoaderData()?.customer;
  return (
    <NewProductSession
      key={JSON.stringify([viewer.account.id, customer?.id])}
      customer={customer}
    />
  );
}

function NewProductSession({ customer }: { customer?: CustomerChoice }) {
  const { productPage, productPageSize } = Route.useSearch();
  const { state } = useLocation();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [draft, setDraft] = useState(() => ({
    ...readProductDraft(),
    customer: customer ?? null,
  }));
  const [issue, setIssue] = useState<ProductFormIssue>();
  const [retry, setRetry] = useState<Submission>();
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const customerOrigin = customer
    ? { customerId: customer.id, page: productPage, pageSize: productPageSize }
    : undefined;
  const canUseCustomerListEntry =
    state.productCustomerList?.customerId === customerOrigin?.customerId &&
    state.productCustomerList?.page === customerOrigin?.page &&
    state.productCustomerList?.pageSize === customerOrigin?.pageSize;
  const listOrigin = productListOrigin({
    ...state,
    productCustomerList: customerOrigin,
    productListEntryIndex: canUseCustomerListEntry
      ? state.productListEntryIndex
      : undefined,
  });

  function cancel() {
    const destination = productListDestination(listOrigin);
    if (
      customerOrigin &&
      listOrigin.productListEntryIndex === state.__TSR_index - 1 &&
      router.history.canGoBack()
    ) {
      const { publicHref } = router.buildLocation(destination);
      replaceProductEntryAndGoBack(router.history, publicHref);
      return;
    }
    void navigate({ ...destination, replace: true });
  }

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
        state: listOrigin,
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
      customerLocked={Boolean(customer)}
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
      onCancel={cancel}
    />
  );
}
