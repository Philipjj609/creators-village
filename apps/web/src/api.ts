export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  const b = await r.json().catch(() => null);
  if (!r.ok)
    throw new HttpError(
      typeof b?.error === "string"
        ? b.error
        : (b?.error?.code ?? "The request could not be completed."),
      r.status,
    );
  return b as T;
}
