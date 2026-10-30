import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import type { PublicIdentity } from "@creators-village/contracts";
import { api } from "./api.js";
const Context = createContext<{
  person: PublicIdentity | null;
  loaded: boolean;
  error: string;
  refresh: () => Promise<void>;
}>({ person: null, loaded: false, error: "", refresh: async () => {} });
export function SessionProvider({ children }: { children: ReactNode }) {
  const [person, setPerson] = useState<PublicIdentity | null>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await api<{ person: PublicIdentity | null }>("/api/me");
      setPerson((old) =>
        JSON.stringify(old) === JSON.stringify(r.person) ? old : r.person,
      );
      setError("");
    } catch {
      setError("Account status is unavailable. Please retry.");
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const visible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [refresh]);
  return (
    <Context.Provider value={{ person, loaded, error, refresh }}>
      {children}
    </Context.Provider>
  );
}
export const useSession = () => useContext(Context);
