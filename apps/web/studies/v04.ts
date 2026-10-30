import { mountStudy, validateStudy } from "@creators-village/renderer/study";
import "./v04.css";
const root = document.querySelector<HTMLDivElement>("#study")!;
root.innerHTML = `<header><div><span class="eyebrow">CREATOR’S VILLAGE · V04 STUDY</span><h1>Brookside Commons</h1></div><button id="places-toggle" aria-expanded="false" aria-controls="places">Places <span>5</span></button></header><main><div id="world" aria-label="Explore Brookside Commons"></div><div id="loading" role="status">Opening the commons…</div><aside id="places" aria-label="Neighborhood places" hidden><h2>Around the commons</h2><div id="place-list"></div></aside><aside id="inspection" aria-label="Building inspection" hidden><button id="close-inspection" class="close" aria-label="Close building inspection">×</button><span id="kind" class="eyebrow"></span><h2 id="building-name"></h2><p id="story"></p><button id="focus">Approach this building</button></aside><nav aria-label="Village camera"><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="fit" aria-label="Fit neighborhood">⌂</button></nav><button id="return" hidden>← Return to the commons</button></main><footer><span id="view-status" role="status">One shared neighborhood · drag to wander · scroll or pinch to zoom</span><span>Read-only visual study · artistic review pending</span><details><summary>Review diagnostics</summary><pre id="metrics"></pre></details></footer>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let view: Awaited<ReturnType<typeof mountStudy>> | undefined,
  selected: string | undefined;
const manifest = validateStudy(
  await (
    await fetch("/study-assets/v04-neighborhood-study-01/manifest.json")
  ).json(),
);
function select(id: string) {
  const b = manifest.buildings.find((b) => b.id === id)!;
  selected = id;
  el("inspection").hidden = false;
  el("building-name").textContent = b.name;
  el("kind").textContent = b.kind;
  el("story").textContent = b.story;
  el("places").hidden = true;
  el("places-toggle").setAttribute("aria-expanded", "false");
}
for (const b of manifest.buildings) {
  const button = document.createElement("button");
  button.textContent = b.name;
  button.dataset.building = b.id;
  button.addEventListener("click", () => {
    view?.select(b.id);
    select(b.id);
  });
  el("place-list").append(button);
}
el("places-toggle").onclick = () => {
  const open = el("places").hidden;
  el("places").hidden = !open;
  el("places-toggle").setAttribute("aria-expanded", String(open));
};
el("close-inspection").onclick = () => {
  el("inspection").hidden = true;
};
async function reset() {
  await view?.reset();
  el("return").hidden = true;
  el("view-status").textContent =
    "One shared neighborhood · drag to wander · scroll or pinch to zoom";
}
el("focus").onclick = async () => {
  if (!view || !selected) return;
  try {
    await view.focus(selected);
  } catch {
    el("view-status").textContent =
      "Closer detail unavailable. The neighborhood remains explorable.";
    return;
  }
  el("return").hidden = false;
  el("view-status").textContent =
    "Same source geometry and materials · a closer view";
};
el("return").onclick = () => void reset();
el("fit").onclick = () => void reset();
el("zoom-in").onclick = () => view?.zoom(1.2);
el("zoom-out").onclick = () => view?.zoom(1 / 1.2);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") void reset();
});
try {
  view = await mountStudy(el("world"), manifest, select);
  el("loading").hidden = true;
  root.dataset.renderState = "ready";
} catch {
  el("loading").textContent =
    "Graphics unavailable. Explore the five places using the Places list.";
  root.dataset.renderState = "fallback";
  el<HTMLButtonElement>("focus").disabled = true;
  el("places").hidden = false;
  el("places-toggle").setAttribute("aria-expanded", "true");
}
function publishMetrics() {
  el("metrics").textContent = JSON.stringify(
    view?.stats() ?? { renderer: "accessible fallback" },
    null,
    2,
  );
}
publishMetrics();
const diagnosticsTimer = setInterval(publishMetrics, 500);
window.addEventListener(
  "pagehide",
  () => {
    clearInterval(diagnosticsTimer);
    void view?.destroy();
  },
  { once: true },
);
