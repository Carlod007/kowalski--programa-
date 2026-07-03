// src/router.tsx
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  Outlet,
} from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

// Importa tus páginas reales
import Login from "@/pages/auth/Login";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";

// ⚡ Layout encargado de la protección (sin necesidad de recibir children)
function ProtectedLayout() {
  const { user, isAuthLoading } = useAuthStore();

  // Estado de carga global mientras Firebase recupera la sesión
  if (isAuthLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        Cargando...
      </div>
    );
  }

  // Si no hay usuario, redirige al login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Si está autenticado, renderiza la ruta hija correspondiente (Dashboard, Onboarding, etc.)
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    path: "/login",
    element: <Login />,
  },
  {
    path: "/",
    element: <Navigate to="/login" replace />,
  },
  {
    // Aquí aplicas el guardia UNA SOLA VEZ
    element: <ProtectedLayout />,
    children: [
      {
        path: "/onboarding",
        element: <Onboarding />,
      },
      {
        path: "/dashboard",
        element: <Dashboard />,
      },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
