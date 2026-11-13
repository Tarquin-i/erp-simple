import { type FormEvent, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  CustomerContact,
  CustomerContactMethod,
  CustomerContactMethodInput,
  CustomerContactMethodType,
} from "@/request/customers";

import { contactMethodLabels } from "./changes";
import type { ContactChange } from "./changes";

export type ContactEditorMode =
  | { kind: "add"; contacts: CustomerContact[]; selectedContactId?: string }
  | { kind: "rename"; contact: CustomerContact }
  | { kind: "edit"; contact: CustomerContact; method: CustomerContactMethod };

const newContactId = "new-contact";

function contactOptionLabel(
  contact: CustomerContact,
  contacts: CustomerContact[]
) {
  const sameName = contacts.filter((item) => item.name === contact.name);
  if (sameName.length === 1) return contact.name;

  const primaryValue = contact.methods.find(
    (method) => method.isPrimary
  )?.value;
  const position = sameName.findIndex((item) => item.id === contact.id) + 1;
  return `${contact.name}（同名 ${position}） · ${primaryValue ?? "暂无联系方式"}`;
}

export function CustomerContactEditor({
  mode,
  pending,
  locked,
  error,
  onClose,
  onSubmit,
}: {
  mode: ContactEditorMode;
  pending: boolean;
  locked: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (change: ContactChange) => void;
}) {
  const id = useId();
  const method = mode.kind === "edit" ? mode.method : undefined;
  const [selectedContactId, setSelectedContactId] = useState(
    mode.kind === "add"
      ? (mode.selectedContactId ?? newContactId)
      : mode.contact.id
  );
  const [name, setName] = useState(
    mode.kind === "rename" ? mode.contact.name : ""
  );
  const [type, setType] = useState<CustomerContactMethodType | "">(
    method?.type ?? ""
  );
  const [value, setValue] = useState(method?.value ?? "");
  const [isPrimary, setIsPrimary] = useState(method?.isPrimary ?? false);
  const [validation, setValidation] = useState("");

  const selected =
    mode.kind === "add"
      ? mode.contacts.find((contact) => contact.id === selectedContactId)
      : mode.contact;
  const showName = mode.kind === "rename" || !selected;
  const takenTypes =
    selected?.methods
      .filter((item) => item.id !== method?.id)
      .map((item) => item.type) ?? [];
  const title =
    mode.kind === "rename"
      ? "编辑联系人"
      : mode.kind === "edit"
        ? "编辑联系方式"
        : "添加联系方式";
  const changed =
    mode.kind === "rename"
      ? name.trim() !== mode.contact.name
      : !method ||
        type !== method.type ||
        value.trim() !== method.value ||
        isPrimary !== method.isPrimary;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || !changed) return;
    setValidation("");
    const cleanedName = name.trim();
    if (showName && !cleanedName) {
      setValidation("请输入联系人姓名。");
      return;
    }
    if (mode.kind === "rename") {
      onSubmit({ kind: "rename", contact: mode.contact, name: cleanedName });
      return;
    }

    const cleanedValue = value.trim();
    if (!type || !cleanedValue || takenTypes.includes(type)) {
      setValidation("请选择可用的联系方式并填写联系信息。");
      return;
    }
    if (mode.kind === "edit") {
      const fields: Partial<CustomerContactMethodInput> = {};
      if (type !== mode.method.type) fields.type = type;
      if (cleanedValue !== mode.method.value) fields.value = cleanedValue;
      if (isPrimary !== mode.method.isPrimary) fields.isPrimary = isPrimary;
      onSubmit({
        kind: "edit",
        contact: mode.contact,
        methodId: mode.method.id,
        fields,
      });
      return;
    }

    const newMethod = { type, value: cleanedValue, isPrimary };
    onSubmit(
      selected
        ? { kind: "add", contact: selected, method: newMethod }
        : { kind: "create", name: cleanedName, method: newMethod }
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="text-lg font-semibold">{title}</SheetTitle>
          <SheetDescription className="sr-only">
            维护当前客户的联系人及联系信息。
          </SheetDescription>
        </SheetHeader>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={submit}
          noValidate
        >
          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            {mode.kind === "add" && mode.contacts.length > 0 && (
              <Field>
                <FieldLabel htmlFor={`${id}-person`}>联系人</FieldLabel>
                <Select
                  disabled={locked}
                  value={selectedContactId}
                  onValueChange={(next) => {
                    setSelectedContactId(next);
                    setValidation("");
                    if (
                      mode.contacts
                        .find((contact) => contact.id === next)
                        ?.methods.some((item) => item.type === type)
                    )
                      setType("");
                  }}
                >
                  <SelectTrigger className="w-full" id={`${id}-person`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={newContactId}>新建联系人</SelectItem>
                    {mode.contacts.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contactOptionLabel(contact, mode.contacts)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {showName && (
              <Field>
                <FieldLabel htmlFor={`${id}-name`}>联系人姓名</FieldLabel>
                <Input
                  id={`${id}-name`}
                  value={name}
                  maxLength={128}
                  disabled={locked}
                  required
                  onChange={(event) => {
                    setName(event.target.value);
                    setValidation("");
                  }}
                />
              </Field>
            )}
            {mode.kind === "edit" && (
              <div className="space-y-1.5 text-sm">
                <p className="text-muted-foreground">联系人</p>
                <p className="font-medium">{mode.contact.name}</p>
              </div>
            )}
            {mode.kind !== "rename" && (
              <>
                <Field>
                  <FieldLabel htmlFor={`${id}-type`}>联系方式</FieldLabel>
                  <Select
                    disabled={locked}
                    value={type}
                    onValueChange={(next) => {
                      setType(next as CustomerContactMethodType);
                      setValidation("");
                    }}
                  >
                    <SelectTrigger className="w-full" id={`${id}-type`}>
                      <SelectValue placeholder="选择联系方式" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(contactMethodLabels).map(
                        ([methodType, label]) => (
                          <SelectItem
                            key={methodType}
                            value={methodType}
                            disabled={takenTypes.some(
                              (taken) => taken === methodType
                            )}
                          >
                            {label}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-value`}>联系信息</FieldLabel>
                  <Input
                    id={`${id}-value`}
                    type={
                      type === "email"
                        ? "email"
                        : type === "phone" || type === "whatsapp"
                          ? "tel"
                          : "text"
                    }
                    value={value}
                    maxLength={320}
                    disabled={locked}
                    required
                    onChange={(event) => {
                      setValue(event.target.value);
                      setValidation("");
                    }}
                  />
                  {(type === "phone" || type === "whatsapp") && (
                    <FieldDescription>
                      仅支持中国大陆手机号，可带 +86。
                    </FieldDescription>
                  )}
                </Field>
                {selected &&
                  (selected.methods.length > 1 ||
                    (mode.kind === "add" && selected.methods.length > 0)) && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox
                        checked={isPrimary}
                        disabled={locked}
                        onCheckedChange={(checked) =>
                          setIsPrimary(checked === true)
                        }
                      />
                      设为主要联系方式
                    </label>
                  )}
              </>
            )}
            <FieldError>{validation || error}</FieldError>
          </div>
          <SheetFooter className="flex-row justify-end gap-2 border-t px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={onClose}
            >
              取消
            </Button>
            <Button type="submit" disabled={locked || !changed}>
              {pending ? "正在保存…" : "保存"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
