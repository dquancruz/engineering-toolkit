/** Limits every browser can draw: Safari on iOS allows 16 777 216 pixels, and 16 384 on a side. */
export const MAX_SIDE = 16_384;
export const MAX_AREA = 16_777_216;

export function pngSize(width: number, height: number, scale: number): { width: number; height: number; scaled: boolean } {
  const factor = Math.min(scale, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)));
  return { width: Math.max(1, Math.floor(width * factor)), height: Math.max(1, Math.floor(height * factor)), scaled: factor < scale };
}
