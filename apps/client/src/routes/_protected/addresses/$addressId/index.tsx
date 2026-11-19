import {
  createFileRoute,
  Link,
  useLocation,
  useRouter,
} from "@tanstack/react-router";
import { Archive, Pencil, Plus, Star } from "lucide-react";
import { useRef, useState } from "react";

import { AddressCollection } from "@/components/addresses/address-collection";
import { AddressFormDialog } from "@/components/addresses/address-form";
import {
  AddressPageError,
  AddressPagePending,
} from "@/components/addresses/load-state";
import {
  customerAddressTabLink,
  readAddressDetailSearch,
} from "@/components/addresses/navigation";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import {
  AddressApiError,
  type AddressDetail,
  archiveAddress,
  getAddress,
  listCustomerAddresses,
  updateAddress,
} from "@/request/addresses";

export const Route = createFileRoute("/_protected/addresses/$addressId/")({
  validateSearch: readAddressDetailSearch,
  loaderDeps: ({ search: { page } }) => ({ page }),
  loader: {
    staleReloadMode: "blocking",
    handler: async ({ params, deps, abortController }) => {
      const signal = abortController.signal;
      const { address } = await getAddress(params.addressId, signal);
      let collection = await listCustomerAddresses(
        address.customerId,
        deps,
        signal
      );
      const last = Math.max(
        1,
        Math.ceil(collection.total / collection.pageSize)
      );
      if (collection.page > last) {
        collection = await listCustomerAddresses(
          address.customerId,
          { page: last },
          signal
        );
      }
      return { address, collection };
    },
  },
  pendingComponent: AddressPagePending,
  pendingMs: 0,
  pendingMinMs: 0,
  errorComponent: ({ error }) => <AddressPageError error={error} detail />,
  component: AddressDetailRoute,
});

function AddressDetailRoute() {
  const data = Route.useLoaderData();
  return <AddressWorkspace key={data.address.id} {...data} />;
}

type AddressWorkspaceProps = {
  address: AddressDetail;
  collection: Awaited<ReturnType<typeof listCustomerAddresses>>;
};

/** 在地址模块内管理一条地址和同一客户的全部有效地址。 */
function AddressWorkspace({ address, collection }: AddressWorkspaceProps) {
  const router = useRouter();
  const navigate = Route.useNavigate();
  const { state } = useLocation();
  const { customerId } = Route.useSearch();
  const [form, setForm] = useState<"create" | "edit" | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [saving, setSaving] = useState<"default" | "archive" | null>(null);
  const mutationPending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const { page, pageSize, total } = collection;
  const returnCustomer = customerId === address.customerId;
  const returnLink = returnCustomer
    ? customerAddressTabLink(customerId, page, state)
    : undefined;
  const navigationState = returnCustomer
    ? { customerListQuery: state.customerListQuery }
    : { addressListQuery: state.addressListQuery };
  const addressSearch = {
    customerId: returnCustomer ? customerId : undefined,
    page: page > 1 ? page : undefined,
  };

  function openForm(mode: "create" | "edit") {
    setError(null);
    setForm(mode);
  }

  /** 使用当前地址版本写入，版本冲突时刷新页面并让用户确认最新资料。 */
  async function changeAddress(action: "default" | "archive") {
    if (mutationPending.current) return;
    mutationPending.current = true;
    const pathname = router.state.location.pathname;
    setSaving(action);
    setError(null);
    try {
      if (action === "archive") {
        await archiveAddress(address.id, address.version);
        if (router.state.location.pathname === pathname) {
          if (returnLink) {
            await navigate({ ...returnLink, replace: true });
          } else {
            await navigate({
              to: "/addresses",
              search: state.addressListQuery ?? {},
              replace: true,
            });
          }
        }
      } else {
        await updateAddress(address.id, address.version, { isDefault: true });
        await router.invalidate();
      }
    } catch (cause) {
      if (cause instanceof AddressApiError && cause.status === 409) {
        await router.invalidate();
        setError("地址已更新，请核对最新资料后再操作。");
      } else {
        setError(cause instanceof Error ? cause.message : "操作失败，请重试。");
      }
    } finally {
      mutationPending.current = false;
      setSaving(null);
    }
  }

  return (
    <main className="min-w-0 flex-1 space-y-6 bg-background px-4 py-5 sm:px-6 sm:py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 className="wrap-break-word text-2xl font-semibold tracking-tight">
            {address.customer.companyName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {address.customer.customerNo}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {returnLink && (
            <Button asChild variant="outline">
              <Link {...returnLink}>返回客户地址</Link>
            </Button>
          )}
          {!address.isDefault && (
            <Button
              type="button"
              variant="outline"
              disabled={saving !== null}
              onClick={() => void changeAddress("default")}
            >
              <Star aria-hidden="true" />
              {saving === "default" ? "正在设置…" : "设为默认"}
            </Button>
          )}
          <AlertDialog
            open={archiveOpen}
            onOpenChange={(open) => {
              if (mutationPending.current) return;
              setArchiveOpen(open);
              setError(null);
            }}
          >
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={saving !== null}
              >
                <Archive aria-hidden="true" />
                归档地址
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>归档地址</AlertDialogTitle>
                <AlertDialogDescription>
                  {address.isDefault
                    ? "归档后，如果该客户仍有有效地址，最近更新的一条会成为默认地址。"
                    : "归档后，这条地址将从该客户的有效地址列表移除。"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {error && <FieldError>{error}</FieldError>}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={saving !== null}>
                  取消
                </AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={saving !== null}
                  onClick={() => void changeAddress("archive")}
                >
                  {saving === "archive" ? "正在归档…" : "确认归档"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            type="button"
            disabled={saving !== null}
            onClick={() => openForm("edit")}
          >
            <Pencil aria-hidden="true" />
            编辑地址
          </Button>
        </div>
      </header>

      {error && !archiveOpen && <FieldError>{error}</FieldError>}

      <section className="rounded-xl border p-4 sm:p-5" aria-label="地址详情">
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <dt className="text-muted-foreground">收货人</dt>
            <dd className="wrap-break-word">{address.recipientName}</dd>
          </div>
          <div className="space-y-1">
            <dt className="text-muted-foreground">联系电话</dt>
            <dd className="tabular-nums">{address.phone}</dd>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <dt className="text-muted-foreground">收货地址</dt>
            <dd className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 wrap-break-word">
                {address.formattedAddress}
              </span>
              {address.isDefault && <Badge variant="secondary">默认地址</Badge>}
            </dd>
          </div>
          {address.remark && (
            <div className="space-y-1 sm:col-span-2">
              <dt className="text-muted-foreground">备注</dt>
              <dd className="wrap-break-word whitespace-pre-wrap">
                {address.remark}
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="space-y-3" aria-labelledby="customer-addresses">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="customer-addresses" className="text-base font-semibold">
            客户地址
          </h2>
          <Button
            type="button"
            variant="outline"
            disabled={saving !== null}
            onClick={() => openForm("create")}
          >
            <Plus aria-hidden="true" />
            新建地址
          </Button>
        </header>
        <AddressCollection
          addresses={collection.addresses}
          currentAddressId={address.id}
          detailSearch={addressSearch}
          detailState={navigationState}
          pagination={{
            page,
            pageSize,
            total,
            onPageChange: (next) =>
              void navigate({
                search: { ...addressSearch, page: next > 1 ? next : undefined },
                state: navigationState,
                resetScroll: false,
              }),
          }}
        />
      </section>

      {form && (
        <AddressFormDialog
          address={form === "edit" ? address : undefined}
          customer={address.customer}
          onClose={() => setForm(null)}
          onSaved={async (saved) => {
            if (form === "edit") {
              await router.invalidate();
            } else {
              await navigate({
                to: "/addresses/$addressId",
                params: { addressId: saved.id },
                search: { customerId: addressSearch.customerId },
                state: navigationState,
              });
            }
            setForm(null);
          }}
        />
      )}
    </main>
  );
}
