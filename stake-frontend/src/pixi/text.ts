import { Text, TextStyle } from "pixi.js";

export function makeText(value: string, size: number, color: number, x = 0, y = 0, align: "left" | "center" | "right" = "left"): Text {
  const text = new Text({
    text: value,
    style: new TextStyle({
      fill: color,
      fontFamily: "Arial, Helvetica, sans-serif",
      fontSize: size,
      fontWeight: "900",
      align
    })
  });
  text.anchor.set(align === "left" ? 0 : align === "right" ? 1 : 0.5, 0);
  text.position.set(x, y);
  return text;
}
