import fs from "node:fs/promises";
import crypto from "node:crypto";
import sharp from "sharp";

// Original source art. E2 keeps authored facade and shared projected geometry views.
const out = "assets/generated/woodland-vector-1";
await fs.mkdir(out, { recursive: true });
let previous;
try {
  previous = JSON.parse(await fs.readFile(`${out}/manifest.json`, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
async function publish(name, bytes) {
  const digest = crypto.createHash("sha256").update(bytes).digest("hex");
  const expected = previous?.assets.find(
    (asset) => asset.name === name,
  )?.sha256;
  let existing;
  try {
    existing = crypto
      .createHash("sha256")
      .update(await fs.readFile(`${out}/${name}`))
      .digest("hex");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if ((expected && expected !== digest) || (existing && existing !== digest))
    throw new Error(
      `Immutable asset changed: ${name}. Publish a new asset version instead.`,
    );
  await fs.writeFile(`${out}/${name}`, bytes);
  return digest;
}
const roofs = ["#b87155", "#688c6b", "#8f7398"];
const darks = ["#814833", "#3f6651", "#635170"];
const creams = ["#f4dfb4", "#eadbc2", "#ecdbcb"];
function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="wall" x2="0.6" y2="1"><stop stop-color="#fff0cf"/><stop offset="1" stop-color="#dbc29e"/></linearGradient><linearGradient id="leaf" x2=".5" y2="1"><stop stop-color="#7f9d63"/><stop offset="1" stop-color="#3b7157"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="3"/></filter></defs>${body}</svg>`;
}
function window(x, y, s = 1) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-12 13V-5Q0-23 12-5V13Z" fill="#677f75" stroke="#826d54" stroke-width="4"/><path d="M-8 10V-4Q0-16 8-4V10Z" fill="#f7ce73"/><path d="M0-14V11M-10 0H10" stroke="#826d54" stroke-width="2.5"/><path d="M-16 14H16" stroke="#b8916a" stroke-width="4" stroke-linecap="round"/></g>`;
}
function flowers(x, y) {
  return `<g transform="translate(${x} ${y})"><path d="M-15 0Q-10-17-3-3Q5-22 11-3Q19-14 21 0" fill="#5e875a"/>${[-12, -4, 6, 15].map((v, i) => `<circle cx="${v}" cy="${-6 - (i % 2) * 5}" r="4" fill="${i % 2 ? "#edb8a2" : "#e5cc7b"}"/>`).join("")}<path d="M-18 0L-13 9H17L22 0Z" fill="#aa7654"/></g>`;
}
function house(shape, palette, front) {
  const roof = roofs[palette],
    dark = darks[palette],
    wall = creams[palette];
  const tower = shape === "tower",
    hall = shape === "hall",
    mill = shape === "mill";
  const top = tower ? 29 : hall ? 45 : mill ? 32 : 60,
    wide = hall ? 98 : mill ? 49 : 77;
  const detail = Array.from(
    { length: 8 },
    (_, i) =>
      `<path d="M${48 + i * 17} ${top + 43 + (i % 2) * 4}l23 33" stroke="${dark}" stroke-opacity=".3" stroke-width="1.8"/>`,
  ).join("");
  let body = `<ellipse cx="133" cy="229" rx="${wide + 10}" ry="16" fill="#324d3a" opacity=".13" filter="url(#soft)"/>`;
  if (front) {
    body += `<path d="M${128 - wide} 222V115H${128 + wide}V222Z" fill="url(#wall)" stroke="#a98d6c" stroke-width="2"/>`;
    body += `<path d="M${118 - wide} 122L128 ${top}L${138 + wide} 122Z" fill="${roof}" stroke="${dark}" stroke-width="5" stroke-linejoin="round"/>`;
    body += `<path d="M${128 - wide + 8} 124L128 ${top + 13}L${128 + wide - 8} 124Z" fill="${dark}" opacity=".12"/>`;
    body +=
      window(128 - wide * 0.57, 164, 0.9) + window(128 + wide * 0.57, 164, 0.9);
  } else {
    body += `<path d="M${128 - wide} 185V112L128 78L${128 + wide} 119V186L128 224Z" fill="${wall}" stroke="#9c8062" stroke-width="2"/>`;
    body += `<path d="M128 147L${128 + wide} 113V187L128 224Z" fill="#c7b48f"/>`;
    body += `<path d="M${118 - wide} 116L83 ${top}L167 ${top + 10}L${138 + wide} 121L128 159Z" fill="${roof}" stroke="${dark}" stroke-width="4" stroke-linejoin="round"/>`;
    body += `<path d="M83 ${top}L128 159L${118 - wide} 116Z" fill="${dark}" opacity=".38"/>${detail}`;
    body += `<path d="M128 158L${138 + wide} 121" stroke="#e7be8e" stroke-width="4" stroke-linecap="round"/>`;
    body +=
      window(81, 162, 0.8) +
      `<g transform="translate(166 170) skewY(-23)">${window(0, 0, 0.8)}</g>`;
  }
  const doorX = front ? 128 : 111,
    doorY = front ? 220 : 214;
  body += `<path d="M${doorX - 12} ${doorY}V${doorY - 32}Q${doorX} ${doorY - 49} ${doorX + 12} ${doorY - 32}V${doorY}Z" fill="#537c6b" stroke="#826d54" stroke-width="3"/><circle cx="${doorX + 6}" cy="${doorY - 17}" r="2" fill="#f5d58c"/><path d="M${doorX - 18} ${doorY + 2}H${doorX + 18}l7 7h-50Z" fill="#c6bca1"/>`;
  if (!mill)
    body += `<path d="M164 ${top + 28}v-26l15-4v33" fill="#b58f78" stroke="#8c6e5d" stroke-width="2"/><path d="M161 ${top + 3}l21-5v7l-21 5Z" fill="#e5c5a6"/><path d="M173 ${top - 2}q-12-13 2-20t-1-20" fill="none" stroke="#f4eedb" stroke-width="7" opacity=".55" stroke-linecap="round"/>`;
  if (shape === "cottage")
    body += `<path d="M48 194Q25 171 46 158Q61 147 58 183Q46 164 38 176" fill="none" stroke="#5d865b" stroke-width="8" stroke-linecap="round"/><circle cx="41" cy="165" r="5" fill="#e9c698"/>`;
  if (shape === "gable")
    body += `<path d="M86 ${top + 20}L114 ${top + 49}L146 ${top + 31}L119 ${top + 1}Z" fill="${dark}"/><path d="M90 ${top + 25}L112 ${top + 51}V${top + 71}L90 ${top + 60}Z" fill="#eedbc0"/>${window(103, top + 51, 0.48)}`;
  if (tower)
    body += `<path d="M100 114h36v-29l-18-21-18 21Z" fill="#ebd4b2" stroke="#92735a" stroke-width="2"/>${window(117, 95, 0.6)}`;
  if (hall)
    body += `<path d="M113 94v-38h27v38" fill="#e8d7b7" stroke="#907859" stroke-width="2"/><path d="M107 58l20-20 20 20Z" fill="${dark}"/><circle cx="127" cy="72" r="8" fill="#f5e3a3" stroke="#846e53" stroke-width="2"/><path d="M127 66v7l4 3" stroke="#846e53" fill="none" stroke-width="2"/><path d="M61 194v18M188 178v25" stroke="#7e604c" stroke-width="4"/><path d="M56 193h11v-14H56ZM183 177h11v-14h-11Z" fill="#ebca7e" stroke="#7e604c" stroke-width="2"/>`;
  if (mill)
    body += `<g transform="translate(130 115) rotate(28)">${[0, 90, 180, 270].map((a) => `<g transform="rotate(${a})"><path d="M0 0V-77H14V-20H0" fill="#e9d9b9" stroke="#876c50" stroke-width="3"/><path d="M1-65h12M1-51h12M1-37h12" stroke="#ad9471" stroke-width="2"/></g>`).join("")}<circle r="9" fill="#b2895b" stroke="#7e644e" stroke-width="3"/></g>`;
  body += flowers(front ? 64 : 69, 214) + flowers(front ? 194 : 175, 208);
  body += `<path d="M46 226l9-1m143-7l10-2" stroke="#f1d9a8" stroke-width="3" stroke-linecap="round"/>`;
  return svg(body);
}
const manifest = {
  version: "woodland-vector-1",
  author: "Creator’s Village original procedural source",
  sources: "scripts/build-assets.mjs",
  assets: [],
};
for (const shape of ["cottage", "gable", "tower", "hall", "mill"])
  for (let palette = 0; palette < 3; palette++)
    for (const view of ["iso", "front"]) {
      const name = `${shape}-${palette}-${view}.png`,
        source = house(shape, palette, view === "front");
      const bytes = await sharp(Buffer.from(source)).png().toBuffer();
      await publish(name, bytes);
      manifest.assets.push({
        name,
        shape,
        palette,
        view,
        width: 256,
        height: 256,
        pivot: { x: 128, y: 226 },
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      });
    }
for (let v = 0; v < 3; v++) {
  const leaf = ["#709866", "#4e8061", "#9aa768"][v];
  const canopy =
    v === 1
      ? `<path d="M128 30L67 143H91L58 187H198L167 143H189Z" fill="${leaf}"/>`
      : `<path d="M75 177C32 154 52 106 77 107C55 75 87 46 116 61C132 26 180 52 179 79C218 77 225 125 197 145C212 180 166 197 148 184C120 203 86 197 75 177Z" fill="${leaf}"/>`;
  const source = svg(
    `<ellipse cx="130" cy="230" rx="61" ry="13" fill="#3f6346" opacity=".15"/><path d="M117 231l8-100h14l8 100Z" fill="#937650"/><path d="M131 193l-24-33m26 16 23-30" stroke="#937650" stroke-width="8"/>${canopy}<path d="M92 113q6-20 25-19m33-20q18 0 22 12M91 159q8 12 25 8" stroke="#c5ce8c" opacity=".38" stroke-width="9" stroke-linecap="round"/>`,
  );
  const name = `tree-${v}.png`,
    bytes = await sharp(Buffer.from(source)).png().toBuffer();
  const sha256 = await publish(name, bytes);
  manifest.assets.push({
    name,
    view: "tree",
    width: 256,
    height: 256,
    pivot: { x: 128, y: 230 },
    sha256,
  });
}
await fs.writeFile(
  `${out}/manifest.json`,
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Verified ${manifest.assets.length} immutable reference assets (30 house views, 3 trees). Visual direction rejected.`,
);
