/** Downloads of the cleaned SVG, as it is or drawn to a PNG. Nothing leaves the browser. */
import { pngSize } from "../core/diagram/png.js";

export const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function toPng(svg: string, width: number, height: number, scale: number, white: boolean): Promise<{ blob: Blob; scaled: boolean }> {
  const size = pngSize(width, height, scale);
  const image = new Image();
  // a data: URL, which the policy allows and which does not taint the canvas
  image.src = svgUrl(svg);
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  if (white) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(image, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The browser could not create the PNG");
  return { blob, scaled: size.scaled };
}
