import { Archive, Ellipsis, LoaderCircle, Pencil, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldError } from "@/components/ui/field";
import { toastManager } from "@/components/ui/toast";
import {
  AddressApiError,
  type AddressDetail,
  type AddressListItem,
  archiveAddress,
  getAddress,
  isAddressSnapshot,
  updateAddress,
} from "@/request/addresses";

import { AddressFormDialog } from "./address-form";

type AddressCardMenuProps = {
  address: AddressListItem;
  detail?: AddressDetail;
  onChanged: (address: AddressDetail) => Promise<boolean>;
  onRetainChange?: (id: string, retained: boolean) => void;
};

type AddressAction = "edit" | "default" | "archive";

/**
 * 为单条地址提供编辑、设默认和归档操作，分别处理加载与版本冲突。
 * @param props 当前地址摘要、已有的详情，以及保存成功后的刷新回调。
 * @returns 地址操作菜单、编辑弹窗和归档确认弹窗。
 */
export function AddressCardMenu({
  address,
  detail,
  onChanged,
  onRetainChange,
}: AddressCardMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  const settingDefault = useRef(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const pendingRead = useRef<AbortController>(null);
  const [busy, setBusy] = useState<AddressAction | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<AddressDetail>();
  const [archiveTarget, setArchiveTarget] = useState<AddressListItem>();
  const [latest, setLatest] = useState<AddressDetail>();
  const availableDetail = detail?.id === address.id ? detail : undefined;
  const newestDetail =
    latest?.id === address.id &&
    latest.version >= (availableDetail?.version ?? 0)
      ? latest
      : availableDetail;
  const currentDetail =
    newestDetail && newestDetail.version >= address.version
      ? newestDetail
      : undefined;
  const current = currentDetail ?? address;
  const retained = Boolean(menuOpen || busy || editing || archiveTarget);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingRead.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!retained || !onRetainChange) return;
    onRetainChange(address.id, true);
    return () => onRetainChange(address.id, false);
  }, [address.id, onRetainChange, retained]);

  function restoreFocus() {
    window.requestAnimationFrame(() =>
      trigger.current?.focus({ preventScroll: true })
    );
  }

  async function readAddress(id: string) {
    const controller = new AbortController();
    pendingRead.current = controller;
    try {
      return (await getAddress(id, controller.signal)).address;
    } finally {
      pendingRead.current = null;
    }
  }

  async function openEditor() {
    if (inFlight.current) return;
    setError("");
    if (currentDetail) {
      openingDialog.current = true;
      setEditing(currentDetail);
      return;
    }

    inFlight.current = true;
    setBusy("edit");
    try {
      const record = await readAddress(address.id);
      if (!mounted.current) return;
      setLatest(record);
      setEditing(record);
    } catch (failure) {
      if (!mounted.current) return;
      setError(
        failure instanceof Error ? failure.message : "暂时无法加载地址详情。"
      );
      restoreFocus();
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  /**
   * 使用操作开始时看到的版本写入。冲突后刷新快照并等待用户再次确认。
   * @param action 修改默认地址或归档的操作。
   * @param target 用户操作时看到的地址摘要及版本。
   * @returns 完成写入和列表更新，失败时展示提示。
   */
  async function changeAddress(
    action: "default" | "archive",
    target: AddressListItem
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action);
    setError("");
    const showFailure = (title: string) => {
      if (action === "default") toastManager.add({ title, type: "error" });
      else setError(title);
    };
    try {
      let record: AddressDetail;
      try {
        const response =
          action === "archive"
            ? await archiveAddress(target.id, target.version)
            : await updateAddress(target.id, target.version, {
                isDefault: true,
              });
        record = response.address;
      } catch (failure) {
        if (!mounted.current) return;
        if (!(failure instanceof AddressApiError && failure.status === 409)) {
          showFailure(
            failure instanceof Error
              ? failure.message
              : "地址操作失败，请重试。"
          );
          return;
        }

        try {
          record = isAddressSnapshot(failure.current, target.id)
            ? failure.current
            : await readAddress(target.id);
        } catch (refreshFailure) {
          if (mounted.current) {
            showFailure(
              refreshFailure instanceof Error
                ? refreshFailure.message
                : "地址已更新，暂时无法读取最新资料，请重试。"
            );
          }
          return;
        }
        if (!mounted.current) return;
        setLatest(record);
        if (action === "archive") setArchiveTarget(record);
        // 默认已由其他用户变更成功时，只更新列表，无须再次提交。
        if (action !== "default" || !record.isDefault) {
          showFailure("地址已更新，请核对最新资料后再操作。");
          return;
        }
      }

      if (mounted.current) {
        setLatest(record);
        setArchiveTarget(undefined);
      }
      try {
        const refreshed = await onChanged(record);
        if (refreshed && action === "default" && mounted.current) {
          toastManager.add({ title: "已设为默认地址", type: "success" });
        }
      } catch {
        if (mounted.current) setError("地址已更新，请刷新列表查看。");
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setBusy(null);
        if (action === "default") restoreFocus();
      }
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <DropdownMenu modal={false} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="更多地址操作"
            aria-busy={busy !== null}
            disabled={busy !== null || currentDetail?.status === "archived"}
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Ellipsis aria-hidden="true" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (!openingDialog.current && !settingDefault.current) return;
            openingDialog.current = false;
            settingDefault.current = false;
            event.preventDefault();
          }}
        >
          <DropdownMenuItem onSelect={() => void openEditor()}>
            <Pencil aria-hidden="true" />
            编辑地址
          </DropdownMenuItem>
          {!current.isDefault && (
            <DropdownMenuItem
              onSelect={() => {
                settingDefault.current = true;
                void changeAddress("default", current);
              }}
            >
              <Star aria-hidden="true" />
              设为默认地址
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              openingDialog.current = true;
              setError("");
              setArchiveTarget(current);
            }}
          >
            <Archive aria-hidden="true" />
            归档地址
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && !archiveTarget && (
        <FieldError className="max-w-36 text-right text-xs wrap-anywhere sm:max-w-60">
          {error}
        </FieldError>
      )}

      {editing && (
        <AddressFormDialog
          address={editing}
          onClose={() => {
            setEditing(undefined);
            restoreFocus();
          }}
          onSaved={async (record) => {
            if (mounted.current) setLatest(record);
            await onChanged(record);
            if (mounted.current) {
              setEditing(undefined);
              restoreFocus();
            }
          }}
        />
      )}

      <AlertDialog
        open={archiveTarget !== undefined}
        onOpenChange={(open) => {
          if (!open && !inFlight.current) {
            setArchiveTarget(undefined);
            setError("");
          }
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>归档地址</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget?.isDefault
                ? "归档后，如果该客户仍有有效地址，最近更新的一条会成为默认地址。"
                : "归档后，这条地址将从该客户的有效地址列表移除。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveTarget && (
            <p className="text-sm wrap-anywhere">
              {archiveTarget.formattedAddress}
            </p>
          )}
          {error && <FieldError>{error}</FieldError>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => {
                if (archiveTarget) void changeAddress("archive", archiveTarget);
              }}
            >
              {busy === "archive" ? "正在归档…" : "确认归档"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
