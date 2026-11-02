import { useEffect, useState } from "react";
import { api } from "./api.js";
import type { Wf2State } from "@creators-village/contracts";
export function AccountRecognition({
  grants,
  receipts,
  act,
  busy,
}: {
  grants: { worldId: string }[];
  receipts: { commandId: string; projectId: string }[];
  act: (kind: string, payload: object, route?: string) => Promise<unknown>;
  busy: boolean;
}) {
  const [worlds, setWorlds] = useState<Record<string, string>>({});
  const key = grants.map((g) => g.worldId).join(",");
  useEffect(() => {
    let active = true;
    const c = new AbortController();
    void Promise.all(
      grants.map(async (g) => {
        try {
          const s = await api<Wf2State>(
            "/api/wf2/worlds/" + g.worldId + "/bootstrap",
            { signal: c.signal },
          );
          return s.projects.map((p) => [p.id, g.worldId] as const);
        } catch {
          return [];
        }
      }),
    ).then((rows) => {
      if (active) setWorlds(Object.fromEntries(rows.flat()));
    });
    return () => {
      active = false;
      c.abort();
    };
  }, [key]);
  return (
    <section className="f2-recognition">
      <h2>Contribution recognition</h2>
      <p>
        Your name stays private unless you opt in for a project. Recognition
        applies to your contributions to that project; you can withdraw it
        without removing accepted work.
      </p>
      {receipts
        .filter(
          (r, i, all) =>
            all.findIndex((x) => x.projectId === r.projectId) === i,
        )
        .map((r, i) => (
          <div key={r.commandId}>
            <h3>Project participation {i + 1}</h3>
            {worlds[r.projectId] && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    "SetRecognition",
                    { projectId: r.projectId, optedIn: true },
                    "/api/wf2/worlds/" + worlds[r.projectId] + "/commands",
                  )
                }
              >
                Show my name on this project
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  "SetRecognition",
                  { projectId: r.projectId, optedIn: false },
                  "/api/wf2/privacy/commands",
                )
              }
            >
              Keep my name private
            </button>
          </div>
        ))}
    </section>
  );
}
