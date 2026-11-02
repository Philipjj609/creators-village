import { useState } from "react";
export type ListMemory = {
  query: string;
  scrollTop: number;
  lastViewedId: string;
  historyOpen: boolean;
};
export const newListMemory = (): ListMemory => ({
  query: "",
  scrollTop: 0,
  lastViewedId: "",
  historyOpen: false,
});
export function searchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}
export type DirectoryItem = {
  key: string;
  name: string;
  description: string;
  search?: string;
  status?: string | undefined;
  group?: string;
};
export function VillageDirectory({
  label,
  items,
  memory,
  select,
  empty = "Nothing here yet.",
}: {
  label: string;
  items: DirectoryItem[];
  memory: ListMemory;
  select: (key: string) => void;
  empty?: string;
}) {
  const [query, setQuery] = useState(memory.query),
    [history, setHistory] = useState(memory.historyOpen);
  const rows = items.filter((i) =>
    searchText(
      i.search ?? i.name + " " + i.description + " " + (i.status ?? ""),
    ).includes(searchText(query.trim())),
  );
  const render = (r: DirectoryItem) => (
    <button
      key={r.key}
      data-object-key={r.key}
      className={
        "pi-place-row" +
        (memory.lastViewedId === r.key ? " ux1-last-viewed" : "")
      }
      onClick={() => {
        memory.lastViewedId = r.key;
        select(r.key);
      }}
    >
      <span>
        {r.name}
        <small>{r.description}</small>
      </span>
      {r.status && <small className="ux1-row-status">{r.status}</small>}
    </button>
  );
  return (
    <div
      className="ux1-directory"
      onKeyDown={(e) => {
        if (
          !(e.target instanceof HTMLElement) ||
          !e.target.closest(".pi-place-row")
        )
          return;
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
        const rows = [
            ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
              ".pi-place-row",
            ),
          ],
          index = rows.indexOf(
            e.target.closest(".pi-place-row") as HTMLButtonElement,
          );
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? rows.length - 1
              : Math.max(
                  0,
                  Math.min(
                    rows.length - 1,
                    index + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                );
        rows[next]?.focus();
        e.preventDefault();
      }}
    >
      <label className="ux1-search">
        Search {label.toLowerCase()}
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            memory.query = e.target.value;
            memory.scrollTop = 0;
          }}
          placeholder={"Search " + label.toLowerCase()}
        />
      </label>
      <p className="ux1-result-count" role="status">
        {rows.length} {rows.length === 1 ? "result" : "results"}
      </p>
      {!items.length ? (
        <p>{empty}</p>
      ) : !rows.length ? (
        <p>
          No matches.{" "}
          <button
            onClick={() => {
              setQuery("");
              memory.query = "";
            }}
          >
            Clear search
          </button>
        </p>
      ) : (
        <>
          {rows.filter((i) => i.group !== "History").map(render)}
          {rows.some((i) => i.group === "History") && (
            <details
              open={Boolean(query) || history}
              onToggle={(e) => {
                memory.historyOpen = e.currentTarget.open;
                setHistory(e.currentTarget.open);
              }}
            >
              <summary>Past projects</summary>
              {rows.filter((i) => i.group === "History").map(render)}
            </details>
          )}
        </>
      )}
    </div>
  );
}
