import { createLucideIcon, Route } from "lucide-react";
import type { IconNode } from "lucide-react";

// Alibaba.com brand silhouette, Simple Icons 16.21.0 (CC0).
// https://github.com/simple-icons/simple-icons/blob/16.21.0/icons/alibabadotcom.svg
const alibabaChannelGlyph: IconNode = [
  [
    "path",
    {
      d: "M14.391 16.22c-.963.044-.865-.459-.302-1.234 1.32-1.768 3.82-4.236 3.906-5.982.151-2.283-2.143-3.026-4.501-3.004-1.645.022-3.344.492-4.501.906C5 8.315 2.489 10.576.909 13.076-.768 15.554-.216 17.923 3.322 18c2.716-.109 4.48-.862 6.32-1.802.01 0-5.086 1.453-6.958.383l-.008-.002c-.193-.11-.404-.264-.457-.683-.012-.885 1.46-1.802 2.283-2.097v-1.533a5.374 5.374 0 0 0 1.955.366 5.378 5.378 0 0 0 3.472-1.265c.037.13.056.278.044.447h.371c.048-.394-.172-.706-.172-.706-.333-.529-.915-.52-.915-.52s.315.137.529.466a4.953 4.953 0 0 1-4.665.932l1.21-1.2-.336-.874c2.435-.852 4.48-1.507 7.812-2.085l-.746-.624.389-.24c2.01.568 3.325.985 3.253 2.051a2.672 2.672 0 0 1-.202.611c-.584 1.158-2.326 3.09-3.029 3.898-.465.535-.92 1.06-1.245 1.562-.335.503-.54.971-.551 1.42.043 3.504 10.334-1.64 12.324-3.003-2.943 1.266-6.113 2.489-9.609 2.718Z",
      fill: "currentColor",
      key: "brand",
      stroke: "none",
    },
  ],
];

// H 和 K 的图形沿用 Huivo 的渠道图标。
const kingwinChannelGlyph: IconNode = [
  [
    "rect",
    { height: "18", key: "frame", rx: "4", width: "18", x: "3", y: "3" },
  ],
  ["path", { d: "M8 7v10m8-10-7 5 7 5", key: "kingwin" }],
];
const huivoChannelGlyph: IconNode = [
  [
    "rect",
    { height: "18", key: "frame", rx: "4", width: "18", x: "3", y: "3" },
  ],
  ["path", { d: "M8 7v10m8-10v10M8 12h8", key: "huivo" }],
];

const AlibabaIcon = createLucideIcon("alibaba", alibabaChannelGlyph);
const HuivoIcon = createLucideIcon("huivo", huivoChannelGlyph);
const KingwinIcon = createLucideIcon("kingwin", kingwinChannelGlyph);

const huivoColor = "lch(48 59.31 288.43)";
const kingwinColor = "#26b5ce";
const channelBrands = new Map([
  ["huivo_alibaba", { icon: AlibabaIcon, color: huivoColor }],
  ["huivo_international_station", { icon: HuivoIcon, color: huivoColor }],
  ["kingwin_alibaba", { icon: AlibabaIcon, color: kingwinColor }],
  ["kingwin_international_station", { icon: KingwinIcon, color: kingwinColor }],
]);

export function CustomerChannelIcon({ code }: { code?: string }) {
  const brand = code ? channelBrands.get(code) : undefined;
  const Icon = brand?.icon ?? Route;

  return (
    <Icon
      aria-hidden="true"
      className="size-3.5 shrink-0 text-muted-foreground"
      style={brand ? { color: brand.color } : undefined}
    />
  );
}
