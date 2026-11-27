import {
  DEFAULT_PHONE_COUNTRY,
  parsePhoneNumberFromString,
} from "@repo/server";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { copyAddressValue } from "./copy-address-value";

/** 以国际格式展示地址电话，与服务端对无区号号码的解析规则一致。 */
export function formatAddressPhone(phone: string) {
  if (phone.includes("*")) return phone;
  const number = parsePhoneNumberFromString(phone.trim(), {
    defaultCountry: DEFAULT_PHONE_COUNTRY,
    extract: false,
  });
  return number?.isValid() && !number.ext
    ? number.formatInternational()
    : phone;
}

/** 展示地址电话，并提供鼠标和键盘可用的复制入口。 */
export function AddressPhoneValue({ phone }: { phone: string }) {
  if (!phone.trim() || phone.includes("*")) {
    return <span className="wrap-anywhere tabular-nums">{phone}</span>;
  }

  const formattedPhone = formatAddressPhone(phone);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="link"
          className="h-auto min-w-0 shrink rounded-sm border-0 p-0 text-left font-normal whitespace-normal text-inherit wrap-anywhere tabular-nums underline-offset-auto"
          aria-label={`复制联系电话：${formattedPhone}`}
          onClick={() =>
            void copyAddressValue(
              formattedPhone,
              "已复制联系电话",
              "复制联系电话失败，请重试。"
            )
          }
        >
          {formattedPhone}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={5}>点击复制</TooltipContent>
    </Tooltip>
  );
}
