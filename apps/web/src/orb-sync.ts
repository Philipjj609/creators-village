import type { OrbWallet } from "@creators-village/contracts";

/** One private request at a time. Stream invalidations never contain wallet data. */
export function startOrbSync(options: {
  read: (heartbeat: boolean) => Promise<OrbWallet>;
  visible: () => boolean;
  value: (wallet: OrbWallet) => void;
  error: (error: unknown) => boolean;
}) {
  let stopped = false,
    pending: boolean | null = null,
    running: Promise<void> | null = null,
    boundary: ReturnType<typeof setTimeout> | undefined,
    latest: OrbWallet | null = null;
  async function drain() {
    while (!stopped && pending !== null && options.visible()) {
      const heartbeat = pending;
      pending = null;
      try {
        const wallet = await options.read(heartbeat);
        if (stopped) return;
        if (
          !latest ||
          BigInt(wallet.revision) > BigInt(latest.revision) ||
          (wallet.revision === latest.revision &&
            wallet.serverTime >= latest.serverTime)
        ) {
          latest = wallet;
          options.value(wallet);
          clearTimeout(boundary);
          if (wallet.balance < wallet.cap)
            boundary = setTimeout(
              () => void refresh(true),
              Math.max(250, wallet.nextAwardInMs + 50),
            );
        }
      } catch (error) {
        if (!stopped && options.error(error)) stop();
      }
    }
  }
  function refresh(heartbeat = false): Promise<void> {
    if (stopped || !options.visible()) return Promise.resolve();
    // Coalesce invalidations, but never lose a heartbeat behind a read.
    pending = pending === true || heartbeat;
    if (!running)
      running = drain().finally(() => {
        running = null;
      });
    return running;
  }
  const pulse = setInterval(() => void refresh(true), 15000);
  function stop() {
    stopped = true;
    pending = null;
    clearInterval(pulse);
    clearTimeout(boundary);
  }
  return { refresh, stop };
}

export function contributionAmount(value: number, maximum: number) {
  const max = Math.max(0, Math.floor(maximum));
  return max === 0
    ? 0
    : Math.min(
        max,
        Math.max(1, Number.isFinite(value) ? Math.floor(value) : 1),
      );
}
