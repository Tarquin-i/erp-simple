import { createHash } from "node:crypto";
import { isConstraintError } from "@repo/db";
import type { Database, DatabaseTransaction } from "@repo/db";

import { failVersionConflict } from "../../../errors";
import { withRecordReadSnapshot } from "../../organization";
import type { AccountRecordAccess } from "../../organization";
import { lockCustomerForWrite } from "../../customer";
import {
  formatAddress,
  resolvePostalAddressPatch,
} from "../domain/postal-address";
import {
  archiveAddressRecord,
  clearDefaultAddress,
  findAddress,
  findAddressCustomer,
  findDefaultAddress,
  findSavedAddress,
  insertAddress,
  lockAddressCreateRequest,
  lockAddressForWrite,
  promoteNextAddress,
  selectAddressPage,
  updateAddressRecord,
} from "../persistence/delivery-addresses";
import type {
  Address,
  AddressCreateInput,
  AddressCustomer,
  AddressDirectoryQuery,
  AddressPagination,
  AddressPatch,
} from "../persistence/delivery-addresses";
import { createAddressError } from "./errors";

const defaultConstraint = "customer_address_customer_default_unique";

/** 遇到 PostgreSQL 死锁时，在新事务内重试完整写入。 */
async function withAddressWrite<T>(
  db: Database,
  run: (tx: DatabaseTransaction) => Promise<T>
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(run);
    } catch (error) {
      if (isConstraintError(error, "23505", defaultConstraint)) {
        throw createAddressError("defaultChanged");
      }
      const cause = error instanceof Error ? (error.cause ?? error) : error;
      if (
        typeof cause !== "object" ||
        cause === null ||
        !("code" in cause) ||
        cause.code !== "40P01"
      ) {
        throw error;
      }
      if (attempt === 3) throw createAddressError("concurrentWrite");
    }
  }
}

/**
 * 生成地址详情和写入响应共用的展示数据。
 * @param row 数据库地址记录。
 * @param owner 已通过权限校验的所属客户摘要。
 * @returns 地址字段、所属客户摘要和格式化地址。
 */
function addressView(
  row: Address,
  { id, customerNo, companyName }: AddressCustomer
) {
  const {
    creationActorUserId,
    creationRequestId,
    creationRequestHash,
    ...address
  } = row;
  return {
    ...address,
    customer: { id, customerNo, companyName },
    formattedAddress: formatAddress(address),
  };
}

async function lockAddressAtVersion(
  tx: DatabaseTransaction,
  access: AccountRecordAccess,
  addressId: string,
  expectedVersion: number,
  includeArchived: boolean
) {
  const target = await lockAddressForWrite(
    tx,
    access,
    addressId,
    includeArchived
  );
  if (!target) throw createAddressError("addressNotFound");

  const { address, record } = target;
  if (address.status === "archived") {
    if (address.version !== expectedVersion + 1) {
      throw createAddressError("addressNotFound");
    }
  } else if (address.version !== expectedVersion) {
    failVersionConflict(addressView(address, record));
  }
  return target;
}

function addressPageView({
  rows,
  total,
  page,
  pageSize,
}: Awaited<ReturnType<typeof selectAddressPage>>) {
  return {
    addresses: rows.map(({ address, location, customer: owner }) => ({
      ...address,
      customer: owner,
      formattedAddress: formatAddress(location),
    })),
    total,
    page,
    pageSize,
  };
}

export function createDeliveryAddressUseCases(db: Database) {
  return {
    listDefaultAddresses(
      access: AccountRecordAccess,
      query: AddressDirectoryQuery
    ) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, currentAccess) =>
          addressPageView(await selectAddressPage(tx, currentAccess, query)),
        db
      );
    },
    listCustomerAddresses(
      access: AccountRecordAccess,
      customerId: string,
      pagination: AddressPagination
    ) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, currentAccess) => {
          const owner = await findAddressCustomer(
            tx,
            currentAccess,
            customerId
          );
          if (!owner) throw createAddressError("customerNotFound");

          const result = await selectAddressPage(
            tx,
            currentAccess,
            pagination,
            customerId
          );
          return { ...addressPageView(result), customer: owner };
        },
        db
      );
    },
    getAddress(access: AccountRecordAccess, addressId: string) {
      return withRecordReadSnapshot(
        access.userId,
        async (tx, currentAccess) => {
          const record = await findAddress(tx, currentAccess, addressId);
          if (!record) throw createAddressError("addressNotFound");
          return addressView(record.address, record.customer);
        },
        db
      );
    },
    /**
     * 新建地址，第一条自动设为默认。替换时校验用户看到的默认地址快照。
     * 同一个提交 ID 重试时，在当前客户权限下返回原记录。
     */
    createAddress(
      access: AccountRecordAccess,
      customerId: string,
      input: AddressCreateInput,
      expectedDefault: { id: string; version: number } | null | undefined,
      requestId: string
    ) {
      // 确认替换前后属于同一次新建，只对地址资料计算指纹。
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ customerId, ...input }))
        .digest("hex");
      return withAddressWrite(db, async (tx) => {
        const existing = await lockAddressCreateRequest(
          tx,
          access.userId,
          requestId
        );
        const { record } = await lockCustomerForWrite(
          tx,
          access,
          existing?.customerId ?? customerId
        );
        if (existing) {
          const saved = await findSavedAddress(tx, record.id, existing.id);
          if (!saved) throw createAddressError("addressNotFound");
          if (saved.creationRequestHash !== requestHash) {
            throw createAddressError("idempotencyConflict");
          }
          return addressView(saved, record);
        }

        const currentDefault = await findDefaultAddress(tx, customerId);
        const defaultNeedsConfirmation = currentDefault
          ? expectedDefault?.id !== currentDefault.id ||
            expectedDefault?.version !== currentDefault.version
          : expectedDefault != null;
        if (input.isDefault && defaultNeedsConfirmation) {
          throw createAddressError(
            expectedDefault === undefined
              ? "defaultConfirmationRequired"
              : "defaultConfirmationStale",
            currentDefault ? addressView(currentDefault, record) : null
          );
        }
        if (input.isDefault && currentDefault) {
          await clearDefaultAddress(tx, customerId);
        }

        const created = await insertAddress(
          tx,
          customerId,
          { ...input, isDefault: input.isDefault || !currentDefault },
          { userId: access.userId, id: requestId, hash: requestHash }
        );
        return addressView(created, record);
      });
    },
    /** 更新地址资料。切换默认时先清除原记录上的默认标记。 */
    updateAddress(
      access: AccountRecordAccess,
      addressId: string,
      input: AddressPatch,
      expectedVersion: number
    ) {
      return withAddressWrite(db, async (tx) => {
        const { address, record } = await lockAddressAtVersion(
          tx,
          access,
          addressId,
          expectedVersion,
          false
        );
        if (address.isDefault && input.isDefault === false) {
          throw createAddressError(
            "defaultUnsetForbidden",
            addressView(address, record)
          );
        }
        const patch = resolvePostalAddressPatch(address, input);
        if (!patch.ok) throw createAddressError(patch.reason);

        if (input.isDefault && !address.isDefault) {
          // 部分唯一索引立即生效，旧默认必须先取消。
          await clearDefaultAddress(tx, record.id);
        }
        const updated = await updateAddressRecord(tx, addressId, {
          ...input,
          ...patch.fields,
        });
        return addressView(updated, record);
      });
    },
    /** 归档默认地址时在同一事务内递补。同一原版本可重试。 */
    archiveAddress(
      access: AccountRecordAccess,
      addressId: string,
      expectedVersion: number
    ) {
      return withAddressWrite(db, async (tx) => {
        const { address, record } = await lockAddressAtVersion(
          tx,
          access,
          addressId,
          expectedVersion,
          true
        );
        if (address.status === "archived") return addressView(address, record);

        const archived = await archiveAddressRecord(tx, addressId);
        if (address.isDefault) await promoteNextAddress(tx, record.id);
        return addressView(archived, record);
      });
    },
  };
}
