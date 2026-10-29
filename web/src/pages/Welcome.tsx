/** Card W11 · Public welcome page (SPEC §4.1), dark landing theme. */
import { useEffect } from "react";
import { Link } from "react-router-dom";

import "./welcome.css";

const MARKERS: [string, number, number][] = [
  ["1", 55, 64.5],
  ["2", 27, 42.4],
  ["3", 70, 40.2],
  ["4", 14, 76.2],
  ["4", 83, 80.5],
  ["5", 75, 61.4],
  ["6", 28, 61.4],
];

const STEPS = [
  ["01", "Analyze", "Findings draft the moment a study arrives and appear as they are checked.", "Usually within a minute once the GPU is warm"],
  ["02", "Review", "Accept, edit or reject each finding on the image, with measurements drawn on the film.", "Keyboard-fast · accept all when it's all normal"],
  ["03", "Sign", "A structured report drafted from your decisions. Your impression, your signature.", "Locks with a timestamp and hash"],
  ["04", "Patient note", "Plain language, written from the signed report only and checked against it.", "Edit any wording before it goes out"],
  ["05", "Share", "A one-page PDF to print or hand over, with the patient's consent recorded.", "The image and findings stay in the record"],
];

const PRINCIPLES = [
  ["You stay in charge", "Every finding is accepted, edited or rejected by you. The report is yours and it locks when you sign."],
  ["Private and compliant", "Clinical workflows run in a private, compliant manner at scale. Patients receive the plain-language note only."],
  ["Fully traceable", "Each agent step is logged with its model, duration and tokens in the console, beside the clinician's actions."],
];

export default function WelcomePage() {
  useEffect(() => {
    document.documentElement.dataset.theme = "landing";
    document.title = "HelioDX · Clinical AI Workflow";
    return () => {
      delete document.documentElement.dataset.theme;
      document.title = "HelioDX";
    };
  }, []);

  return (
    <div className="lx">
      <header className="lx-header">
        <Link to="/" aria-label="HelioDX home" className="lx-logo">
          <img src="/heliodx-lockup.png" alt="HelioDX" />
        </Link>
        <div style={{ flex: "1 1 auto" }} />
        <nav aria-label="Primary" className="lx-nav">
          <a className="navlink" href="#expect">
            What to expect
          </a>
          <Link className="navlink" to="/worklist">
            Log in
          </Link>
          <a className="pill pill-dark" href="#contact" style={{ minHeight: 44 }}>
            Contact us
          </a>
        </nav>
      </header>

      <section aria-label="Introduction" className="lx-hero">
        <div role="img" aria-label="A chest X-ray with HelioDX finding markers: cardiac silhouette within limits, costophrenic angles sharp, six findings drafted in 27 seconds" className="lx-art">
          <img src="/cxr-hero.jpg" alt="" aria-hidden="true" className="lx-art__img" />
          <div aria-hidden="true" className="lx-fade lx-fade--left" />
          <div aria-hidden="true" className="lx-fade lx-fade--vertical" />
          <div aria-hidden="true" className="lx-fade lx-fade--right" />
          <div aria-hidden="true" className="lx-fade lx-fade--glow" />
          <div className="ln" aria-hidden="true" style={{ left: "40%", top: "65.6%", width: "30%" }} />
          <div className="ln" aria-hidden="true" style={{ left: "14%", top: "70%", width: "70%" }} />
          {MARKERS.map(([n, x, y], i) => (
            <span key={i} className="mk" aria-hidden="true" style={{ left: `${x}%`, top: `${y}%` }}>
              {n}
            </span>
          ))}
          <div className="lfchip" aria-hidden="true" style={{ left: "59%", top: "51%" }}>
            <span className="ok" />
            Cardiac silhouette · within limits · <span className="mono">CTR 0.43</span>
          </div>
          <div className="lfchip" aria-hidden="true" style={{ left: "51%", top: "80.5%" }}>
            <span className="ok" />
            Costophrenic angles · sharp
          </div>
          <div className="lfchip" aria-hidden="true" style={{ right: "6%", top: "9%" }}>
            <span className="ok" />
            6 findings drafted in <span className="mono">27 s</span>
          </div>
        </div>
        <div className="lx-wrap lx-hero__inner">
          <div className="lx-hero__text">
            <span className="lx-label">Clinician-reviewed imaging findings</span>
            <h1>
              The platform for <span>Clinical AI Workflow</span>
            </h1>
            <p className="lx-body lx-lead">HelioDX: Meta Muse Wonder coordinating a team of Muse Glimmer agents that run the radiology workflow privately, on the clinic's own GPU.</p>
            <div className="lx-pills">
              <Link className="pill pill-light" to="/worklist">
                Log in
              </Link>
              <a className="pill pill-dark" href="#contact">
                Contact us
              </a>
            </div>
            <div className="lx-small">
              <span>A study, start to finish, in about two minutes</span>
              <span aria-hidden="true">·</span>
              <span>Nothing reaches a patient until you sign</span>
            </div>
          </div>
        </div>
      </section>

      <section id="expect" aria-label="What to expect" className="lx-sec">
        <div className="lx-wrap lx-col">
          <div className="lx-sec__head">
            <div className="lx-col" style={{ gap: 8 }}>
              <span className="lx-label">What to expect</span>
              <h2>Five steps. You decide at every one.</h2>
            </div>
            <p className="lx-muted" style={{ maxWidth: 420 }}>
              Studies are analyzed on arrival, so a draft is usually waiting when you open one. Every agent step is logged beside your own actions.
            </p>
          </div>
          <div className="lx-steps">
            {STEPS.map(([n, title, body, hint]) => (
              <div key={n} className="lx-card lx-step">
                <span className="n">{n}</span>
                <h3>{title}</h3>
                <p>{body}</p>
                <span className="t">{hint}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-label="Principles" className="lx-sec lx-sec--principles">
        <div className="lx-wrap lx-principles">
          {PRINCIPLES.map(([title, body]) => (
            <div key={title} className="lx-card lx-principle">
              <h3>{title}</h3>
              <p className="lx-body">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer id="contact" className="lx-footer">
        <div className="lx-wrap lx-footer__inner">
          <span className="lx-badge">
            <img src="/meta-logo.png" alt="Meta" />
          </span>
          <p className="lx-footer__title">Powered by Meta AI</p>
          <p className="lx-muted" style={{ fontSize: 13.5 }}>
            Muse Wonder · Muse Glimmer · SAM 3.1 · Muse Voice Transcribe
          </p>
          <div className="lx-links">
            <Link to="/worklist">Log in</Link>
            <a href="#contact">Contact us</a>
            <Link to="/console">Agent console</Link>
          </div>
          <p className="lx-muted" style={{ fontSize: 12.5 }}>
            Research Beta · Not ready for clinical use
          </p>
        </div>
      </footer>
    </div>
  );
}
