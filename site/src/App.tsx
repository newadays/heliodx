import { useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import type { PublicResults } from "@/functions/src/eval/publicSchema";
import { resultsLink, useResults, type LoadState } from "./data";
import { Home } from "./pages/Home";
import { Methods } from "./pages/Methods";
import { TaskPage } from "./pages/TaskPage";
import { Tasks } from "./pages/Tasks";

const APP_URL = "https://app.heliodx.com";

export function App() {
  const state = useResults();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <div className="top-in">
          <Link to="/" className="brand" aria-label="HelioDX evaluation, home">
            <img src="/heliodx-lockup.png" alt="" width={69} height={34} />
            <span className="brand-sub">Evaluation</span>
          </Link>
          <nav aria-label="Main">
            <NavLink to="/" end className="nav">
              Results
            </NavLink>
            <NavLink to="/tasks" className="nav">
              Tasks
            </NavLink>
            <NavLink to="/methods" className="nav">
              Methods
            </NavLink>
          </nav>
        </div>
      </header>
      <main id="main" className="page">
        <Body state={state} />
      </main>
      <Footer />
    </>
  );
}

function Body({ state }: { state: LoadState }) {
  if (state.status === "loading") {
    return (
      <p className="state" role="status">
        Loading the latest results…
      </p>
    );
  }
  if (state.status !== "ready") {
    return (
      <section className="state" role="status">
        <h1 className="display-sm">Results are being published; check back shortly.</h1>
        <p className="muted">
          {state.status === "invalid" ? "The results file did not match the format this page reads." : "The results file could not be loaded."} The method is on{" "}
          <Link to="/methods">Methods</Link>.
        </p>
      </section>
    );
  }
  return <Page data={state.data} />;
}

/**
 * Four routes, matched here rather than with <Routes>: the pages read the
 * query string (filters, system, tab) as a prop, so a change to it alone
 * always re-renders them.
 */
function Page({ data }: { data: PublicResults }) {
  const { pathname, search } = useLocation();
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return <Home data={data} />;
  if (path === "/tasks") return <Tasks data={data} search={search} />;
  if (path === "/methods") return <Methods data={data} />;
  const task = /^\/tasks\/([\w-]+)$/.exec(path);
  if (task) return <TaskPage data={data} id={task[1]} search={search} />;
  return (
    <section className="state">
      <h1 className="display-sm">Page not found</h1>
      <p>
        <Link to="/">Back to the results</Link>
      </p>
    </section>
  );
}

function Footer() {
  const json = resultsLink();
  return (
    <footer className="foot">
      <div className="foot-in">
        <p>
          <strong>HelioDX is a research prototype and is not for clinical use.</strong> MedGemma is used under the Health AI Developer Foundations terms of use and is
          not for clinical use.
        </p>
        <p className="muted">
          Films: NIH Clinical Center ChestX-ray14 (Wang et al., CVPR 2017); Shenzhen and Montgomery County chest X-ray sets, courtesy of the U.S. National Library of
          Medicine, Shenzhen No. 3 People's Hospital and the Montgomery County Department of Health and Human Services. Lung outlines by SAM 3.1.
        </p>
        <p className="foot-links">
          {json ? <a href={json}>Results JSON</a> : null}
          <a href={APP_URL}>Clinician app</a>
          <a href="https://github.com/newadays/heliodx/tree/develop/eval">Method and code</a>
        </p>
      </div>
    </footer>
  );
}
