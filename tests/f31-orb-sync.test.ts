import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { startOrbSync, contributionAmount } from "../apps/web/src/orb-sync.js";
import { OrbFunding } from "../apps/web/src/Orbs.js";
import type { OrbWallet, Wf2Project } from "@creators-village/contracts";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { createElement } = require("react"),
  { renderToStaticMarkup } = require("react-dom/server");
const wallet = (
  revision = "1",
  balance = 30,
  nextAwardInMs = 1000,
): OrbWallet => ({
  version: "community-orbs-1",
  balance,
  revision,
  serverTime: Date.now(),
  nextAwardInMs,
  cap: 120,
  award: 5,
  intervalMs: 300000,
});
afterEach(() => vi.useRealTimers());
it("settles the next earning boundary without a document reload or a fabricated balance", async () => {
  vi.useFakeTimers();
  const values: OrbWallet[] = [];
  const read = vi
    .fn()
    .mockResolvedValueOnce(wallet())
    .mockResolvedValue(wallet("2", 35, 300000));
  const s = startOrbSync({
    read,
    visible: () => true,
    value: (v) => values.push(v),
    error: () => false,
  });
  await s.refresh(true);
  await vi.advanceTimersByTimeAsync(1049);
  expect(values.map((v) => v.balance)).toEqual([30]);
  await vi.advanceTimersByTimeAsync(1);
  expect(read.mock.calls).toEqual([[true], [true]]);
  expect(values.map((v) => v.balance)).toEqual([30, 35]);
  s.stop();
});
it("coalesces stream/action invalidations behind one in-flight request and preserves a queued heartbeat", async () => {
  vi.useFakeTimers();
  let resolve!: (v: OrbWallet) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(() => new Promise<OrbWallet>((r) => (resolve = r)))
    .mockResolvedValue(wallet("3", 20));
  const values: number[] = [];
  const s = startOrbSync({
    read,
    visible: () => true,
    value: (v) => values.push(v.balance),
    error: () => false,
  });
  const first = s.refresh(false);
  void s.refresh(false);
  void s.refresh(true);
  void s.refresh(false);
  expect(read).toHaveBeenCalledTimes(1);
  resolve(wallet("2", 30));
  await first;
  expect(read.mock.calls).toEqual([[false], [true]]);
  expect(values).toEqual([30, 20]);
  s.stop();
});
it("ignores old responses but accepts an updated countdown at the same wallet revision", async () => {
  const values: OrbWallet[] = [];
  const read = vi
    .fn()
    .mockResolvedValueOnce(wallet("5", 20, 5000))
    .mockResolvedValueOnce(wallet("4", 30))
    .mockResolvedValueOnce(wallet("5", 20, 2000));
  const s = startOrbSync({
    read,
    visible: () => true,
    value: (v) => values.push(v),
    error: () => false,
  });
  await s.refresh();
  await s.refresh();
  await s.refresh();
  expect(values.map((v) => v.nextAwardInMs)).toEqual([5000, 2000]);
  s.stop();
});
it("does not award hidden/offline time locally and resumes from a server heartbeat", async () => {
  vi.useFakeTimers();
  let visible = true;
  const read = vi.fn().mockResolvedValue(wallet());
  const s = startOrbSync({
    read,
    visible: () => visible,
    value: () => {},
    error: () => false,
  });
  await s.refresh(true);
  visible = false;
  await vi.advanceTimersByTimeAsync(360000);
  expect(read).toHaveBeenCalledTimes(1);
  visible = true;
  await s.refresh(true);
  expect(read).toHaveBeenCalledTimes(2);
  s.stop();
});
it("recovers a temporary failure and permanently stops on revoked authorization", async () => {
  vi.useFakeTimers();
  const error = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
  const read = vi
    .fn()
    .mockRejectedValueOnce(Error("offline"))
    .mockResolvedValueOnce(wallet())
    .mockRejectedValue(Error("denied"));
  const value = vi.fn();
  const s = startOrbSync({ read, visible: () => true, value, error });
  await s.refresh(true);
  await vi.advanceTimersByTimeAsync(15000);
  expect(value).toHaveBeenCalledTimes(1);
  await s.refresh();
  await vi.advanceTimersByTimeAsync(60000);
  expect(read).toHaveBeenCalledTimes(3);
  s.stop();
});
it("cleans up timers and rejects a late response from a previous world", async () => {
  vi.useFakeTimers();
  let resolve!: (v: OrbWallet) => void;
  const value = vi.fn(),
    read = vi.fn(() => new Promise<OrbWallet>((r) => (resolve = r)));
  const s = startOrbSync({
    read,
    visible: () => true,
    value,
    error: () => false,
  });
  const flight = s.refresh(true);
  s.stop();
  resolve(wallet());
  await flight;
  await vi.advanceTimersByTimeAsync(60000);
  expect(value).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledTimes(1);
});
it("clamps typed amounts and funds nothing when balance or remaining funding is zero", () => {
  expect(
    [0, -10, NaN, Infinity, 2.9, 100].map((v) => contributionAmount(v, 12)),
  ).toEqual([1, 1, 1, 1, 2, 12]);
  expect(contributionAmount(10, 0)).toBe(0);
  expect(contributionAmount(10, -5)).toBe(0);
  expect(contributionAmount(15, 3)).toBe(3);
});
it("renders a synchronized keyboard slider/input bounded by both balance and remaining funding", () => {
  const project = {
    id: "p",
    state: "open",
    goal: 60,
    acceptedCount: 57,
    planHash: "a".repeat(64),
    revision: "1",
  } as Wf2Project;
  const markup = (balance: number) =>
    renderToStaticMarkup(
      createElement(OrbFunding, {
        world: "w",
        project,
        csrf: "test",
        wallet: wallet("1", balance),
        canContribute: true,
        refresh: async () => {},
        creditRevision: "1",
      }),
    );
  expect(markup(20)).toContain('type="range"');
  expect(markup(20).match(/max="3"/g)).toHaveLength(2);
  expect(markup(20).match(/value="3"/g)).toHaveLength(2);
  expect(markup(0).match(/disabled=""/g)).toHaveLength(3);
});
