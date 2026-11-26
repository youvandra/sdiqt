import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider, useParams } from "react-router";
import { Layout } from "./components/Layout.tsx";
import { Explorer } from "./pages/Explorer.tsx";
import { Home } from "./pages/Home.tsx";
import { Privacy, Terms } from "./pages/Legal.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { Rollup } from "./pages/Rollup.tsx";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/sections.css";

/** Old `/batches/:i` links were sdiqt-1 batches; open them on its rollup page. */
function BatchRedirect() {
  const { index = "" } = useParams();
  return <Navigate to={`/r/sdiqt-1?batch=${encodeURIComponent(index)}`} replace />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/rollups", element: <Explorer /> },
      { path: "/r/:id", element: <Rollup /> },
      { path: "/privacy", element: <Privacy /> },
      { path: "/terms", element: <Terms /> },
      { path: "/batches", element: <Navigate to="/r/sdiqt-1#batches" replace /> },
      { path: "/batches/:index", element: <BatchRedirect /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
