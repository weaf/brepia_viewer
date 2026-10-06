import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Box, Menu, ShieldCheck } from 'lucide-react';
import { useEffect } from 'react';

import { BrepiaBrand } from '@/components/brand';
import { useAuth } from '@/contexts/AuthContext';

const productCards = [
  {
    eyebrow: '01 / Explore',
    title: 'Start from a sentence',
    copy: 'Describe the part, enclosure, or fixture you need. Brepia turns a clear brief into an editable parametric starting point.',
    className: 'landing-card landing-card--blue',
  },
  {
    eyebrow: '02 / Refine',
    title: 'Keep the design legible',
    copy: 'Work in the same conversation as the model. Adjust dimensions, inspect the result, and keep the construction history close at hand.',
    className: 'landing-card landing-card--violet',
  },
  {
    eyebrow: '03 / Export',
    title: 'Take geometry with you',
    copy: 'Move from Brepia to your existing CAD tools with native BRep and STEP workflows built into the workspace.',
    className: 'landing-card landing-card--green',
  },
];

export function LandingView() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && user) {
      void navigate({ to: '/app', replace: true });
    }
  }, [isLoading, navigate, user]);

  if (isLoading || user) {
    return (
      <div className="landing-loading" aria-label="Loading Brepia">
        <BrepiaBrand showByNoty />
      </div>
    );
  }

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <Link to="/" aria-label="Brepia home" className="landing-nav-brand">
          <BrepiaBrand showByNoty wordmarkClassName="landing-wordmark" />
        </Link>
        <nav aria-label="Public navigation" className="landing-nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#capabilities">Capabilities</a>
          <Link to="/privacy-policy">Privacy</Link>
          <Link to="/signin" className="landing-nav-signin">
            Sign in <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </nav>
        <Link
          to="/signin"
          className="landing-mobile-signin"
          aria-label="Open Brepia"
        >
          <Menu aria-hidden="true" size={20} />
        </Link>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <p className="landing-kicker">
              Parametric design, in plain language
            </p>
            <h1 id="landing-title">
              Make the shape <em>before</em> you make the file.
            </h1>
            <p className="landing-hero-lede">
              Brepia is a focused workspace for turning product ideas into
              editable 3D geometry. Start with intent, then refine the model
              with tools that keep the result yours.
            </p>
            <div className="landing-actions">
              <Link to="/signin" className="landing-primary-action">
                Open the workspace <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <a href="#how-it-works" className="landing-secondary-action">
                See how it works
              </a>
            </div>
            <p className="landing-note">
              Free to explore locally. No billing flow in the workspace.
            </p>
          </div>
          <div
            className="landing-hero-visual"
            aria-label="Brepia model preview"
          >
            <div className="landing-orbit landing-orbit--one" />
            <div className="landing-orbit landing-orbit--two" />
            <div className="landing-model-card">
              <div className="landing-model-topline">
                <span>BREP / 014</span>
                <span className="landing-status-dot">ready</span>
              </div>
              <div className="landing-wireframe" aria-hidden="true">
                <span className="landing-wireframe-body" />
                <span className="landing-wireframe-axis landing-wireframe-axis--x" />
                <span className="landing-wireframe-axis landing-wireframe-axis--y" />
                <span className="landing-wireframe-axis landing-wireframe-axis--z" />
              </div>
              <div className="landing-model-footer">
                <span>native parametric body</span>
                <span>0.01 mm</span>
              </div>
            </div>
            <div className="landing-hero-caption">
              <Box aria-hidden="true" size={16} />
              <span>From brief to editable geometry</span>
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="landing-process"
          aria-labelledby="process-title"
        >
          <div className="landing-section-heading">
            <p className="landing-kicker">A clear first run</p>
            <h2 id="process-title">The workspace follows your thinking.</h2>
          </div>
          <div className="landing-process-grid">
            <div>
              <span className="landing-step-number">01</span>
              <h3>Give it the brief</h3>
              <p>
                Describe the object, constraints, and what the finished part
                needs to do.
              </p>
            </div>
            <div>
              <span className="landing-step-number">02</span>
              <h3>Shape the result</h3>
              <p>
                Use the conversation and model preview together. Keep asking for
                precise changes.
              </p>
            </div>
            <div>
              <span className="landing-step-number">03</span>
              <h3>Export with confidence</h3>
              <p>
                Save the project, open the BRep workspace, or export a STEP file
                for the next tool.
              </p>
            </div>
          </div>
        </section>

        <section
          id="capabilities"
          className="landing-capabilities"
          aria-labelledby="capabilities-title"
        >
          <div className="landing-section-heading landing-section-heading--wide">
            <p className="landing-kicker">Built for real geometry</p>
            <h2 id="capabilities-title">
              A quiet surface for complicated work.
            </h2>
          </div>
          <div className="landing-card-grid">
            {productCards.map((card) => (
              <article key={card.eyebrow} className={card.className}>
                <p className="landing-card-eyebrow">{card.eyebrow}</p>
                <h3>{card.title}</h3>
                <p>{card.copy}</p>
                <ArrowRight aria-hidden="true" size={18} />
              </article>
            ))}
          </div>
        </section>

        <section className="landing-cta" aria-labelledby="cta-title">
          <div>
            <p className="landing-kicker">Your next model starts here</p>
            <h2 id="cta-title">Bring a useful idea.</h2>
          </div>
          <Link to="/signin" className="landing-primary-action">
            Open Brepia <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <BrepiaBrand showByNoty wordmarkClassName="landing-footer-wordmark" />
        <div className="landing-footer-links">
          <span>
            <ShieldCheck aria-hidden="true" size={15} /> Your projects stay in
            your workspace
          </span>
          <Link to="/terms-of-service">Terms</Link>
          <Link to="/privacy-policy">Privacy</Link>
          <a
            href="https://github.com/weaf/brepia"
            target="_blank"
            rel="noreferrer"
          >
            Source
          </a>
          <span className="landing-footer-version">Brepia 2.0 direction</span>
        </div>
      </footer>
    </div>
  );
}
