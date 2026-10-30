import type { AnchorHTMLAttributes, MouseEvent } from "react";

/** Local section navigation never calls the router or mutates browser history. */
export function SectionLink({
  targetId,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { targetId: string }) {
  function scroll(event: MouseEvent<HTMLAnchorElement>) {
    props.onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target ||
      props.download
    )
      return;
    const target = document.getElementById(targetId);
    if (!target) return;
    event.preventDefault();
    const header =
      document.querySelector(".cv-header")?.getBoundingClientRect().height ?? 0;
    const top = Math.max(
      0,
      target.getBoundingClientRect().top + window.scrollY - header - 16,
    );
    target.focus({ preventScroll: true });
    window.scrollTo({
      top,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }
  return (
    <a {...props} href={`#${targetId}`} onClick={scroll}>
      {children}
    </a>
  );
}
