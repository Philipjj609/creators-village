import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "./routing.js";
import { useSession } from "./session.js";
import { Icon, Notice } from "./ui.js";
import "./landing.css";
import { Wordmark } from "./brand.js";
import { SectionLink } from "./section-link.js";
const art = "/landing-art/ui1-01/";
function LandingBrand() {
  return (
    <Link className="cv-brand" href="/" aria-label="Creator’s Village home">
      {/* Corrected owner-supplied SVG belongs in this lockup when available. */}
      <span className="cv-brand-lockup" data-logo-slot="awaiting-corrected-svg">
        <Wordmark />
      </span>
    </Link>
  );
}

function Connection({ closing = false }: { closing?: boolean }) {
  const { person, loaded } = useSession();
  return person ? (
    <Link className="cv-button cv-primary" href="/communities">
      My Communities <span aria-hidden="true">↗</span>
    </Link>
  ) : !loaded ? (
    <span
      className={`cv-connection-pending ${closing ? "on-dark" : ""}`}
      role="status"
    >
      Checking your connection…
    </span>
  ) : (
    <a className="cv-button cv-primary" href="/auth/twitch">
      <img
        className="cv-twitch-icon"
        src={art + "twitch-glitch-white.svg"}
        width="19"
        height="22"
        alt=""
        aria-hidden="true"
      />
      Join with Twitch <span aria-hidden="true">↗</span>
    </a>
  );
}
function PlazaIllustration() {
  const [failed, setFailed] = useState(false);
  return (
    <figure className={`cv-hero-art ${failed ? "cv-art-failed" : ""}`}>
      {!failed ? (
        <picture>
          <source
            media="(max-width: 899px)"
            srcSet={`${art}cv-hero-village-mobile-800.webp 800w, ${art}cv-hero-village-mobile-1100.webp 1100w`}
            sizes="100vw"
          />
          <img
            src={art + "cv-hero-village-1200.webp"}
            srcSet={`${art}cv-hero-village-800.webp 800w, ${art}cv-hero-village-1200.webp 1200w, ${art}cv-hero-village-1600.webp 1600w, ${art}cv-hero-village-2400.webp 2400w`}
            sizes="(max-width: 899px) 100vw, 72vw"
            width="1200"
            height="759"
            fetchPriority="high"
            alt="A composed village illustration: timber homes, a shared hall and workshop linked by paths among autumn trees."
            onError={() => setFailed(true)}
          />
        </picture>
      ) : (
        <div className="cv-art-fallback">
          <p>
            The illustration couldn’t load. You can still explore the current
            village example.
          </p>
          <Link href="/villages/showcase-fern">Explore the world ↗</Link>
        </div>
      )}
    </figure>
  );
}
const ideas = [
  {
    name: "A place to belong",
    icon: "people",
    image: "belong-720.webp",
    width: 720,
    height: 451,
    alt: "A shared hall beside a market and tree-lined paths, from the promotional village render.",
  },
  {
    name: "Build together",
    icon: "hammer",
    image: "build-720.webp",
    width: 720,
    height: 451,
    alt: "A timber workshop and connecting path, from the promotional village render.",
  },
  {
    name: "A world that remembers",
    icon: "leaf",
    image: "remember-720.webp",
    width: 720,
    height: 451,
    alt: "Connected homes and community buildings in the composed village illustration.",
  },
];
export function Landing() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const elements = root.current?.querySelectorAll<HTMLElement>(".cv-reveal");
    if (!elements || !window.IntersectionObserver) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            entry.target.classList.remove("cv-reveal-waiting");
            observer.unobserve(entry.target);
          }
      },
      { threshold: 0.08 },
    );
    if (!motion.matches)
      for (const element of elements) {
        if (element.getBoundingClientRect().top > window.innerHeight)
          element.classList.add("cv-reveal-waiting");
        observer.observe(element);
      }
    const reveal = () => {
      if (motion.matches)
        for (const element of elements)
          element.classList.remove("cv-reveal-waiting");
    };
    motion.addEventListener("change", reveal);
    return () => {
      observer.disconnect();
      motion.removeEventListener("change", reveal);
    };
  }, []);
  const location = useLocation();
  const { error, refresh } = useSession();
  const declined =
    new URL(location, window.location.origin).searchParams.get("auth") ===
    "declined";
  return (
    <div className="pi-site cv-landing" ref={root}>
      <SectionLink className="cv-skip" targetId="main-content">
        Skip to content
      </SectionLink>
      <header className="cv-header">
        <div className="cv-header-inner">
          <LandingBrand />
          <nav aria-label="Main navigation">
            <SectionLink className="cv-nav-link" targetId="how-it-grows">
              How it grows
            </SectionLink>
            <SectionLink className="cv-nav-link" targetId="the-village">
              The village
            </SectionLink>
          </nav>
          <Connection />
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
        {(declined || error) && (
          <div className="cv-account-notice">
            {declined && (
              <Notice kind="error">
                Twitch connection was declined. You can still explore the
                village example.
              </Notice>
            )}
            {error && (
              <Notice kind="error" onRetry={() => void refresh()}>
                {error}
              </Notice>
            )}
          </div>
        )}
        <section className="cv-hero" aria-labelledby="cv-title">
          <div className="cv-hero-copy">
            <p className="cv-eyebrow">
              <Icon name="leaf" /> CREATE · CONNECT · BELONG
            </p>
            <h1 id="cv-title">
              A home for your <br />
              <em>community.</em>
            </h1>
            <p className="cv-hero-description">
              A persistent world where creators and their communities come
              together, build, and grow something that lasts beyond the stream.
            </p>
            <div className="cv-actions">
              <Connection />
              <Link
                className="cv-button cv-secondary"
                href="/villages/showcase-fern"
              >
                Explore the world <span aria-hidden="true">→</span>
              </Link>
            </div>
            <p className="cv-connection-note">
              Connected through <span>Twitch.</span> Shaped by your community.
            </p>
          </div>
          <PlazaIllustration />
        </section>
        <section
          className="cv-ideas"
          id="how-it-grows"
          tabIndex={-1}
          aria-label="What makes a village"
        >
          <div className="cv-section-intro cv-reveal">
            <p className="cv-eyebrow">MORE THAN A MOMENT ON STREAM</p>
            <h2>
              <span>A little world.</span> <span>A place to belong.</span>
            </h2>
          </div>
          <div className="cv-ideas-inner">
            {ideas.map((idea) => (
              <article className="cv-idea cv-reveal" key={idea.name}>
                <div className="cv-idea-heading">
                  <Icon name={idea.icon} />
                  <h3>{idea.name}</h3>
                </div>
                <img
                  src={art + idea.image}
                  width={idea.width}
                  height={idea.height}
                  alt={idea.alt}
                  loading="lazy"
                  decoding="async"
                />
              </article>
            ))}
          </div>
        </section>
        <section
          className="cv-growth cv-reveal"
          id="the-village"
          tabIndex={-1}
          aria-labelledby="cv-growth-title"
        >
          <figure className="cv-story-art">
            <img
              src={art + "cv-hero-village-mobile-1100.webp"}
              width="1100"
              height="696"
              alt="A promotional village composition showing homes, shared spaces and the paths between them."
              loading="lazy"
              decoding="async"
            />
            <figcaption>Promotional village composition</figcaption>
          </figure>
          <div className="cv-growth-content">
            <div className="cv-growth-intro">
              <p className="cv-eyebrow">CREATOR · COMMUNITY · VILLAGE</p>
              <h2 id="cv-growth-title">A story you build together</h2>
              <p>
                A creator starts a village. Approved members help build it, and
                completed work stays for the next visit.
              </p>
              <Link className="cv-inline-link" href="/villages/showcase-fern">
                Step into the current founding example{" "}
                <span aria-hidden="true">→</span>
              </Link>
            </div>
            <ol className="cv-growth-steps">
              <li>
                <span className="cv-step-marker">01</span>
                <div>
                  <h3>Start a village</h3>
                  <p>
                    A gathering shelter and first path give your community a
                    place to begin.
                  </p>
                </div>
              </li>
              <li>
                <span className="cv-step-marker">02</span>
                <div>
                  <h3>Build with your members</h3>
                  <p>
                    The creator publishes a workshop plan. Approved members each
                    contribute once.
                  </p>
                </div>
              </li>
              <li>
                <span className="cv-step-marker">03</span>
                <div>
                  <h3>Come back to what you built</h3>
                  <p>
                    The completed workshop and connecting path stay saved in the
                    same village.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>
        <section
          className="cv-closing cv-reveal"
          aria-labelledby="cv-closing-title"
        >
          <div>
            <p className="cv-eyebrow">A LITTLE WORLD. A SHARED FUTURE.</p>
            <h2 id="cv-closing-title">Make room for belonging.</h2>
            <p>The best part of a village is the people who give it meaning.</p>
          </div>
          <div className="cv-closing-actions">
            <Connection closing />
            <span>
              Sign-in connects your identity.
              <br />
              Participation currently requires creator approval.
            </span>
          </div>
        </section>
      </main>
      <footer className="cv-footer">
        <div className="cv-footer-top">
          <div>
            <LandingBrand />
            <p>A persistent world, made together.</p>
          </div>
          <nav aria-label="Footer navigation">
            <SectionLink targetId="how-it-grows">How it grows</SectionLink>
            <SectionLink targetId="the-village">The village</SectionLink>
            <Link href="/villages/showcase-fern">Explore the world ↗</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
