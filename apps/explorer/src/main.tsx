import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout.tsx";
import { BatchDetail } from "./pages/BatchDetail.tsx";
import { Batches } from "./pages/Batches.tsx";
import { Landing } from "./pages/Landing.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { Security } from "./pages/Security.tsx";
import "./styles/base.css";
import "./styles/components.css";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/batches", element: <Batches /> },
      { path: "/batches/:index", element: <BatchDetail /> },
      { path: "/security", element: <Security /> },
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
