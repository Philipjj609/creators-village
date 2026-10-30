import { useState } from "react";
import { Link, useLocation } from "./routing.js";
import { useSession } from "./session.js";
import { Icon, Notice } from "./ui.js";
import "./landing.css";
import { Brand as LandingBrand, VillageMark } from "./brand.js";
import { SectionLink } from "./section-link.js";

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
      Join with Twitch <span aria-hidden="true">↗</span>
    </a>
  );
}
function PlazaIllustration() {
  const [failed, setFailed] = useState(false);
  return (
    <figure className={`cv-hero-art ${failed ? "cv-art-failed" : ""}`}>
      {!failed ? (
        <img
          src="/landing-art/village-plaza-554.webp"
          srcSet="/landing-art/village-plaza-400.webp 400w, /landing-art/village-plaza-554.webp 554w"
          sizes="(max-width: 600px) 100vw, (max-width: 1000px) 65vw, 800px"
          width="554"
          height="386"
          fetchPriority="high"
          alt="A storybook village plaza beside a river, with warm rooftops, garden paths and neighbors gathering around a fountain."
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="cv-art-fallback">
          <VillageMark />
          <p>
            The illustration couldn’t load. You can still explore the current
            village example.
          </p>
          <Link href="/villages/showcase-fern">Explore the world ↗</Link>
        </div>
      )}
      <figcaption>
        Our illustrated vision <span aria-hidden="true">·</span> not a gameplay
        screenshot
      </figcaption>
    </figure>
  );
}
const ideas = [
  {
    name: "A place to belong",
    icon: "people",
    image: "gathering-312.webp",
    width: 312,
    height: 181,
    alt: "Illustrated woodland neighbors sharing a campfire.",
    copy: "Bring your community together around a place that feels like yours.",
  },
  {
    name: "Built together",
    icon: "hammer",
    image: "shared-place-315.webp",
    width: 315,
    height: 179,
    alt: "An illustrated shared building, with a welcoming doorway and a planted courtyard.",
    copy: "Creator-approved projects turn deliberate contributions into buildings and paths.",
  },
  {
    name: "A world that remembers",
    icon: "leaf",
    image: "community-corner-301.webp",
    width: 301,
    height: 178,
    alt: "An illustrated community corner with timber structures, plants and warm lanterns.",
    copy: "The village keeps what you build, ready for the next time you return.",
  },
];
export function Landing() {
  const location = useLocation();
  const { error, refresh } = useSession();
  const declined =
    new URL(location, window.location.origin).searchParams.get("auth") ===
    "declined";
  return (
    <div className="pi-site cv-landing">
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
            <Connection />
          </nav>
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
              A living world where creators and their communities come together,
              build, and grow something that lasts beyond the stream.
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
          <div className="cv-ideas-inner">
            {ideas.map((idea) => (
              <article className="cv-idea" key={idea.name}>
                <div className="cv-idea-heading">
                  <Icon name={idea.icon} />
                  <h2>{idea.name}</h2>
                </div>
                <p>{idea.copy}</p>
                <img
                  src={"/landing-art/" + idea.image}
                  width={idea.width}
                  height={idea.height}
                  alt={idea.alt}
                  loading="lazy"
                  decoding="async"
                />
              </article>
            ))}
          </div>
          <p className="cv-art-note">
            Concept illustrations show the direction we’re growing toward. The
            current village example shows what runs today.
          </p>
        </section>
        <section
          className="cv-growth"
          id="the-village"
          tabIndex={-1}
          aria-labelledby="cv-growth-title"
        >
          <div className="cv-growth-intro">
            <p className="cv-eyebrow">
              SMALL BEGINNINGS. SHARED POSSIBILITIES.
            </p>
            <h2 id="cv-growth-title">
              One place.
              <br />A story you build together.
            </h2>
            <p>
              A village starts with a gathering place and room to grow.
              Community effort changes that same saved landscape.
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
                <h3>Find your clearing</h3>
                <p>
                  A distinctive landscape, a founding shelter, and a first path.
                </p>
              </div>
            </li>
            <li>
              <span className="cv-step-marker">02</span>
              <div>
                <h3>Choose a shared project</h3>
                <p>
                  In the private playtest, the creator approves participants and
                  publishes a fixed workshop plan.
                </p>
              </div>
            </li>
            <li>
              <span className="cv-step-marker">03</span>
              <div>
                <h3>Leave something lasting</h3>
                <p>
                  Accepted contributions complete a workshop and connecting path
                  in the same village.
                </p>
              </div>
            </li>
          </ol>
        </section>
        <section className="cv-closing" aria-labelledby="cv-closing-title">
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
        <LandingBrand />
        <p>A persistent world, made together.</p>
        <Link href="/villages/showcase-fern">
          Explore the current example ↗
        </Link>
      </footer>
    </div>
  );
}
