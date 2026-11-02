import { useState } from "react";

/** Local visual preferences only; never persisted to a village or account. */
export function VillageAtmosphere() {
  const [lighting, setLighting] = useState(() => {
    try {
      return localStorage.getItem("cv-lighting") === "evening"
        ? "evening"
        : "day";
    } catch {
      return "day";
    }
  });
  const [animate, setAnimate] = useState(() => {
    try {
      return localStorage.getItem("cv-ambient-animation") !== "off";
    } catch {
      return true;
    }
  });
  function save(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Preferences still apply until the page is closed when storage is unavailable. */
    }
    window.dispatchEvent(
      new CustomEvent("cv-atmosphere", {
        detail: {
          lighting: key === "cv-lighting" ? value : lighting,
          animate: key === "cv-ambient-animation" ? value !== "off" : animate,
        },
      }),
    );
  }
  return (
    <fieldset className="ui5-atmosphere">
      <legend>Village atmosphere</legend>
      <label>
        Lighting{" "}
        <select
          value={lighting}
          onChange={(e) => {
            setLighting(e.target.value);
            save("cv-lighting", e.target.value);
          }}
        >
          <option value="day">Daylight</option>
          <option value="evening">Warm evening</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={animate}
          onChange={(e) => {
            setAnimate(e.target.checked);
            save("cv-ambient-animation", e.target.checked ? "on" : "off");
          }}
        />{" "}
        Ambient animation
      </label>
      <p className="pi-muted">
        Appearance on this device. Your reduced-motion preference is respected.
      </p>
    </fieldset>
  );
}
