import {
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from "react";
const event = "cv:navigate";
export function navigate(href: string, replace = false) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || url.pathname.startsWith("/auth/")) {
    location.assign(url.href);
    return;
  }
  history[replace ? "replaceState" : "pushState"](
    null,
    "",
    url.pathname + url.search + url.hash,
  );
  window.dispatchEvent(new Event(event));
}
const subscribe = (cb: () => void) => {
  window.addEventListener(event, cb);
  window.addEventListener("popstate", cb);
  return () => {
    window.removeEventListener(event, cb);
    window.removeEventListener("popstate", cb);
  };
};
export function useLocation() {
  return useSyncExternalStore(
    subscribe,
    () => location.pathname + location.search + location.hash,
  );
}
export function Link({
  href = "/",
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(ev: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(ev);
        if (
          ev.defaultPrevented ||
          ev.button !== 0 ||
          ev.metaKey ||
          ev.ctrlKey ||
          ev.shiftKey ||
          ev.altKey ||
          rest.target ||
          rest.download
        )
          return;
        const u = new URL(href, location.href);
        if (u.origin === location.origin && !u.pathname.startsWith("/auth/")) {
          ev.preventDefault();
          navigate(href);
        }
      }}
    />
  );
}
export function usePanel() {
  const path = useLocation(),
    url = new URL(path, location.origin),
    panel = url.searchParams.get("panel") ?? "";
  return [
    panel,
    (value: string) => {
      const u = new URL(location.href);
      if (value) u.searchParams.set("panel", value);
      else u.searchParams.delete("panel");
      navigate(u.pathname + u.search, Boolean(panel));
    },
  ] as const;
}
