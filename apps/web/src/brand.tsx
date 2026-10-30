import { Link } from "./routing.js";
/** Original house-and-leaf identity; not traced from the concept board. */
export function VillageMark() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M8 24 24 9l16 15M12 22v21h24V22"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M21 43V31h7v12" stroke="currentColor" strokeWidth="2.5" />
      <path
        d="M26 18C25 7 34 4 42 5c0 9-5 16-14 14"
        fill="var(--cv-sage)"
        stroke="var(--cv-cream)"
        strokeWidth="2"
      />
      <path
        d="m28 18 9-9"
        stroke="var(--cv-cream)"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path d="M14 29h5v6h-5z" fill="var(--cv-honey)" />
    </svg>
  );
}
export function Wordmark() {
  return (
    <span className="cv-wordmark">
      Creator’s<span className="cv-wordmark-tail"> Village</span>
    </span>
  );
}
export function Brand({ className = "cv-brand" }: { className?: string }) {
  return (
    <Link className={className} href="/" aria-label="Creator’s Village home">
      <VillageMark />
      <Wordmark />
    </Link>
  );
}
