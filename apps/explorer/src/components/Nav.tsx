import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { REPO_URL } from "../lib/links.ts";
import { GitHubMark } from "./Icons.tsx";
import { Logo } from "./Logo.tsx";

/** Landing sections, linked from the footer. */
export const SECTIONS = [
  { id: "verify", label: "Verify" },
  { id: "how-it-works", label: "How It Works" },
  { id: "security", label: "Security" },
] as const;

/** The explorer lives on its own route; rollup pages sit under it. */
export const EXPLORER = { to: "/rollups", label: "Explorer" } as const;
const inExplorer = (path: string) => path === "/rollups" || path.startsWith("/r/");

/** Logo on the left; the Explorer button and the GitHub mark on the right. */
export function Nav() {
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const here = inExplorer(pathname);
  return (
    <header className="nav" data-scrolled={scrolled}>
      <div className="nav-inner">
        <Logo />
        <div className="nav-end">
          <Link
            to={EXPLORER.to}
            className="btn btn-sm btn-primary nav-cta"
            data-active={here}
            aria-current={here ? "page" : undefined}
          >
            {EXPLORER.label}
          </Link>
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
        </div>
      </div>
    </header>
  );
}
