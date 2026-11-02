import { Container, Graphics, Sprite, type Texture } from "pixi.js";

type AlphaMask = { width: number; height: number; bits: Uint8Array };
const masks = new WeakMap<object, AlphaMask>();
const targets = new WeakMap<
  Container,
  { id: string | null; geometry: Container }
>();
let maskBytes = 0;
/** Decode alpha once per shared image, never read the GPU or allocate a mask on a click. */
export function preparePicking(texture: Texture) {
  const source = texture.source;
  if (masks.has(source)) return;
  const image = source.resource as CanvasImageSource;
  const width = source.pixelWidth,
    height = source.pixelHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw Error("Artwork picking surface unavailable");
  context.drawImage(image, 0, 0, width, height);
  const rgba = context.getImageData(0, 0, width, height).data;
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  for (let i = 0; i < width * height; i++)
    if (rgba[i * 4 + 3]! >= 32) bits[i >> 3]! |= 1 << (i & 7);
  masks.set(source, { width, height, bits });
  maskBytes += bits.byteLength;
  canvas.width = canvas.height = 0;
}
export const pickingStats = () => ({
  pickingAlphaBytes: maskBytes,
  pickingAlphaThreshold: 32,
});
export function registerPick(
  node: Container,
  id: string | null,
  geometry = node,
) {
  targets.set(node, { id, geometry });
}
export function opaquePixel(mask: AlphaMask, x: number, y: number) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  const i = y * mask.width + x;
  return !!(mask.bits[i >> 3]! & (1 << (i & 7)));
}
/** Local point is measured in original untrimmed sprite coordinates, including its ground anchor. */
export function spritePixel(
  texture: Pick<Texture, "orig" | "trim" | "frame">,
  anchor: { x: number; y: number },
  local: { x: number; y: number },
) {
  const x = local.x + anchor.x * texture.orig.width - (texture.trim?.x ?? 0);
  const y = local.y + anchor.y * texture.orig.height - (texture.trim?.y ?? 0);
  const width = texture.trim?.width ?? texture.orig.width;
  const height = texture.trim?.height ?? texture.orig.height;
  return x < 0 || y < 0 || x >= width || y >= height
    ? null
    : { x: texture.frame.x + x, y: texture.frame.y + y };
}
export function visibleGeometry(
  node: Container,
  point: { x: number; y: number },
): boolean {
  if (!node.visible || !node.renderable || node.alpha <= 0) return false;
  if (node instanceof Sprite) {
    const mask = masks.get(node.texture.source);
    const p = spritePixel(node.texture, node.anchor, node.toLocal(point));
    // Missing masks fail closed; a broad bounding rectangle must never select through a roof.
    return !!(mask && p && opaquePixel(mask, p.x, p.y));
  }
  if (node instanceof Graphics && node.containsPoint(node.toLocal(point)))
    return true;
  return [...node.children]
    .reverse()
    .some((child) => visibleGeometry(child, point));
}
/** Actual painter order, shared by residents, buildings and construction. Null IDs are opaque scenery. */
export function pickVisible(
  parent: Container,
  point: { x: number; y: number },
) {
  parent.sortChildren();
  for (const node of [...parent.children].reverse())
    if (
      targets.has(node) &&
      visibleGeometry(targets.get(node)!.geometry, point)
    )
      return { id: targets.get(node)!.id };
  return null;
}
