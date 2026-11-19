import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { copyAddressValue } from "./copy-address-value";

/** 展示地址电话，并提供鼠标和键盘可用的复制入口。 */
export function AddressPhoneValue({ phone }: { phone: string }) {
  if (!phone.trim() || phone.includes("*")) {
    return <span className="wrap-anywhere tabular-nums">{phone}</span>;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="link"
          className="h-auto min-w-0 shrink rounded-sm border-0 p-0 text-left font-normal whitespace-normal text-inherit wrap-anywhere tabular-nums"
          aria-label={`复制联系电话：${phone}`}
          onClick={() =>
            void copyAddressValue(
              phone,
              "已复制联系电话",
              "复制联系电话失败，请重试。"
            )
          }
        >
          {phone}
        </Button>
      </TooltipTrigger>
      <TooltipContent sideOffset={5}>点击复制</TooltipContent>
    </Tooltip>
  );
}
