/** Visible map area below navigation and beside the nonmodal contextual panel. */
export function visibleWorldFrame(host: HTMLElement) {
  const map = host.getBoundingClientRect();
  const shell = host.closest(".ui3-shell") ?? host.parentElement;
  const panel = shell?.querySelector(".pi-panel")?.getBoundingClientRect();
  const overlays = [
    ...(shell?.querySelectorAll(".ui3-identity,.ui3-tools") ?? []),
  ].map((e) => e.getBoundingClientRect());
  const top = Math.max(16, ...overlays.map((r) => r.bottom - map.top + 12));
  let right = map.width - 16,
    bottom = map.height - 16;
  if (panel) {
    if (panel.width >= map.width * 0.7) {
      bottom = Math.min(bottom, panel.top - map.top - 12);
      const toolbar = shell
        ?.querySelector(".pi-map-tools")
        ?.getBoundingClientRect();
      if (toolbar) bottom = Math.min(bottom, toolbar.top - map.top - 12);
    } else right = Math.min(right, panel.left - map.left - 12);
  }
  return {
    x: 16,
    y: top,
    width: Math.max(1, right - 16),
    height: Math.max(1, bottom - top),
  };
}
