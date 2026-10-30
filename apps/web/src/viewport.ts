/** Product layout adapter; rendering does not depend on panel CSS or authority. */
export function visibleWorldFrame(host: HTMLElement) {
  const map = host.getBoundingClientRect();
  const panel = host.parentElement
    ?.querySelector(".pi-panel")
    ?.getBoundingClientRect();
  let width = map.width,
    height = map.height;
  if (panel) {
    if (panel.width >= map.width * 0.7)
      height = Math.max(1, panel.top - map.top);
    else width = Math.max(1, panel.left - map.left);
  }
  return {
    x: 16,
    y: 16,
    width: Math.max(1, width - 32),
    height: Math.max(1, height - 32),
  };
}
