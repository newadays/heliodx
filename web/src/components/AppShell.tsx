/**
 * Signed-in chrome (SPEC §2.2): logo → worklist, the environment chip on every
 * screen, breadcrumb, avatar with the account menu.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { clinicianName, useAuth } from "~/auth/AuthContext";
import { initials } from "~/lib/format";

export interface Crumb {
  label: string;
  to?: string;
}

export const ENV_CHIP = "Research Beta · Not ready for clinical use";

export function AppShell({ crumbs = [], children }: { crumbs?: Crumb[]; children: ReactNode }) {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const name = clinicianName(profile, user?.email ?? "");

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  return (
    <div className="app">
      <header className="hx-header">
        <Link to="/worklist" className="hx-header__logo" aria-label="HelioDX home">
          <img src="/heliodx-lockup.png" alt="HelioDX" />
        </Link>
        <span className="chip chip-env">{ENV_CHIP}</span>
        <div style={{ flex: "1 1 auto" }} />
        {crumbs.length ? (
          <nav aria-label="Breadcrumb" className="hx-crumbs">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} style={{ display: "contents" }}>
                {i > 0 ? <span aria-hidden="true">›</span> : null}
                {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <strong aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</strong>}
              </span>
            ))}
          </nav>
        ) : null}
        <div ref={menuRef}>
          <button type="button" className="hx-avatar" title={name} aria-label={`Account: ${name}`} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            {initials(profile?.displayName ?? name)}
          </button>
          {menu ? (
            <div className="hx-menu" role="menu">
              <p>
                <strong>{name}</strong>
                <br />
                <span className="muted">{user?.email}</span>
              </p>
              <Link className="btn btn-ghost" role="menuitem" to="/console">
                Agent console
              </Link>
              <button
                type="button"
                role="menuitem"
                className="btn btn-ghost"
                onClick={() => {
                  setMenu(false);
                  void signOut().then(() => navigate("/login"));
                }}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}
