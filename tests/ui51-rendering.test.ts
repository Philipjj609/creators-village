import { it, expect } from "vitest";
import {
  Container,
  Sprite,
  Texture,
  Graphics,
  Rectangle,
} from "../packages/renderer/node_modules/pixi.js/lib/index.mjs";
import {
  opaquePixel,
  spritePixel,
  pickVisible,
  registerPick,
} from "../packages/renderer/src/picking.js";
import {
  coastEdges,
  terrainMaterial,
} from "../packages/renderer/src/terrain-style.js";
import {
  prepareResidentArtwork,
  residentArtwork,
} from "../packages/renderer/src/resident-art.js";
it("tests alpha holes, edges, fractional points and an anchored trimmed frame", () => {
  const mask = { width: 4, height: 2, bits: new Uint8Array([0b00000101]) };
  expect(opaquePixel(mask, 0.9, 0)).toBe(true);
  expect(opaquePixel(mask, 1, 0)).toBe(false);
  expect(opaquePixel(mask, -1, 0)).toBe(false);
  expect(opaquePixel(mask, 4, 0)).toBe(false);
  const t = {
    orig: new Rectangle(0, 0, 100, 100),
    trim: new Rectangle(10, 20, 40, 50),
    frame: new Rectangle(200, 300, 40, 50),
  };
  expect(spritePixel(t, { x: 0.5, y: 1 }, { x: -40, y: -80 })).toEqual({
    x: 200,
    y: 300,
  });
  expect(spritePixel(t, { x: 0.5, y: 1 }, { x: 0, y: 0 })).toBeNull();
});
it("uses actual painter order for buildings and residents; opaque scenery blocks selection", () => {
  const world = new Container();
  world.sortableChildren = true;
  const rear = new Graphics().rect(0, 0, 20, 20).fill(0xffffff),
    front = new Graphics().rect(0, 0, 20, 20).fill(0xffffff);
  rear.zIndex = 10;
  front.zIndex = 20;
  registerPick(rear, "resident");
  registerPick(front, "building");
  world.addChild(front, rear);
  expect(pickVisible(world, { x: 5, y: 5 })?.id).toBe("building");
  front.position.set(30, 0);
  expect(pickVisible(world, { x: 5, y: 5 })?.id).toBe("resident");
  registerPick(rear, null);
  expect(pickVisible(world, { x: 5, y: 5 })).toEqual({ id: null });
  expect(pickVisible(world, { x: 100, y: 100 })).toBeNull();
  world.destroy({ children: true });
});
it("never interprets missing chunks as water or changes classification for materials", () => {
  expect(coastEdges(0, 0, (x, y) => (x === 0 && y === 0 ? 0 : 255))).toEqual(
    [],
  );
  const edges = coastEdges(0, 0, (x, y) => (x === 1 && y === 0 ? 1 : 0));
  expect(edges).toHaveLength(1);
  expect(edges[0]!.corners).toEqual([
    [1, 0],
    [1, 1],
  ]);
  expect(coastEdges(0, 0, () => 1)).toEqual([]);
  expect(
    terrainMaterial({ x: 0, y: 0, flags: 0, slope: 0, waterNeighbors: 0 }),
  ).toBe(0xa4ae84);
});
it("rejects duplicated identities before allocating sprites and scopes cast to fictional residents", async () => {
  let count = 0;
  await expect(
    prepareResidentArtwork(
      ["same", "same"],
      async () => ++count,
      () => true,
      () => {},
    ),
  ).rejects.toThrow("Duplicate");
  expect(count).toBe(0);
  expect(residentArtwork("twitch:mira")).toBeNull();
});

it("picks a layered construction place in painter order, with gaps passing through to a rear object", () => {
  const world = new Container();
  world.sortableChildren = true;
  const rear = new Graphics().rect(0, 0, 30, 30).fill(0xffffff);
  const place = new Container();
  place.zIndex = 20;
  rear.zIndex = 10;
  place.addChild(
    new Graphics().rect(0, 0, 5, 30).rect(25, 0, 5, 30).fill(0xffffff),
  );
  registerPick(place, "project:active");
  registerPick(rear, "completed-workshop");
  world.addChild(place, rear);
  expect(pickVisible(world, { x: 2, y: 10 })?.id).toBe("project:active");
  expect(pickVisible(world, { x: 15, y: 10 })?.id).toBe("completed-workshop");
  place.visible = false;
  expect(pickVisible(world, { x: 2, y: 10 })?.id).toBe("completed-workshop");
  world.destroy({ children: true });
});
