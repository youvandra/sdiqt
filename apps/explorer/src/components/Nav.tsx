import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { REPO_URL } from "../lib/links.ts";
import { Logo } from "./Logo.tsx";

const LINKS = [
  { to: "/batches", label: "Batches" },
  { to: "/#how-it-works", label: "How It Works" },
  { to: "/security", label: "Security" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the menu on every navigation
  useEffect(() => setOpen(false), [location.pathname, location.hash]);

  return (
    <header className="nav">
      <div className="nav-header">
        <div className="nav-logo">
          <Logo />
        </div>
        <nav className="nav-links" aria-label="Main">
          {LINKS.map((l) =>
            l.to.includes("#") ? (
              <Link key={l.to} to={l.to} className="nav-link t-body">
                {l.label}
              </Link>
            ) : (
              <NavLink key={l.to} to={l.to} className="nav-link t-body">
                {l.label}
              </NavLink>
            ),
          )}
        </nav>
        <div className="nav-cta">
          <a className="btn btn-secondary" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
        <button
          type="button"
          className="nav-burger"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>
      {open && (
        <nav className="nav-menu" aria-label="Mobile">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className="t-large">
              {l.label}
            </NavLink>
          ))}
          <a className="t-large" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
      )}
    </header>
  );
}
