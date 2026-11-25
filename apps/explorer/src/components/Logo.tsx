import { Link } from "react-router";

/** The brand glyph: six squares in a 2x3 grid and a diamond, 20x20. */
export function LogoGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M0 0h5v5H0zM7 0h5v5H7zM0 7.5h5v5H0zM7 7.5h5v5H7zM0 15h5v5H0zM7 15h5v5H7zM17 7l3 3-3 3-3-3z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Logo({ gap = 10 }: { gap?: number }) {
  return (
    <Link to="/" className="logo" style={{ gap }} aria-label="SDIQT home">
      <LogoGlyph />
      <span className="t-logo">SDIQT</span>
    </Link>
  );
}
