import { Outlet } from "react-router";
import { Footer } from "./Footer.tsx";
import { Nav } from "./Nav.tsx";

export function Layout() {
  return (
    <div className="page">
      <Nav />
      <main
        style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <Outlet />
      </main>
      <Footer />
      <div className="noise" aria-hidden="true" />
    </div>
  );
}
