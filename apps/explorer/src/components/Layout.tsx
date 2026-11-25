import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { Footer } from "./Footer.tsx";
import { Nav } from "./Nav.tsx";

/** Scroll to `#id` after navigation, or to the top on a new page. */
function useScrollToHash() {
  const { pathname, hash } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pathname scrolls to the top
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0);
      return;
    }
    const id = decodeURIComponent(hash.slice(1));
    const t = window.setTimeout(() => document.getElementById(id)?.scrollIntoView(), 0);
    return () => window.clearTimeout(t);
  }, [pathname, hash]);
}

export function Layout() {
  useScrollToHash();
  return (
    <div className="page">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Nav />
      <main id="main" className="main">
        <Outlet />
      </main>
      <Footer />
      <div className="noise" aria-hidden="true" />
    </div>
  );
}
