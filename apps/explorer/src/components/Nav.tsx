import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { REPO_URL } from "../lib/links.ts";
import { GitHubMark } from "./Icons.tsx";
import { Logo } from "./Logo.tsx";

export const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "batches", label: "Batches" },
  { id: "how-it-works", label: "How It Works" },
  { id: "verify", label: "Verify" },
  { id: "security", label: "Security" },
] as const;

/** The section whose top passed the nav last, on the home page. */
function useActiveSection(enabled: boolean): string | undefined {
  const [active, setActive] = useState<string>();
  useEffect(() => {
    if (!enabled) return setActive(undefined);
    const onScroll = () => {
      let current: string | undefined;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 120) current = s.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled]);
  return active;
}

export function Nav() {
  const { pathname, hash } = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const active = useActiveSection(pathname === "/");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the menu on every navigation
  useEffect(() => setOpen(false), [pathname, hash]);

  return (
    <header className="nav" data-scrolled={scrolled || open}>
      <div className="nav-inner">
        <Logo />
        <nav className="nav-links" aria-label="Sections">
          {SECTIONS.map((s) => (
            <Link key={s.id} to={`/#${s.id}`} className="nav-link" data-active={active === s.id}>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="nav-end">
          <a
            className="icon-btn"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="SDIQT on GitHub"
            title="GitHub"
          >
            <GitHubMark />
          </a>
          <button
            type="button"
            className="icon-btn nav-burger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="nav-menu" aria-label="Sections">
          {SECTIONS.map((s) => (
            <Link key={s.id} to={`/#${s.id}`} className="t-large">
              {s.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
