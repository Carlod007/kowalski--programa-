import {
  createBrowserRouter,
  Navigate,
  Outlet,
  RouterProvider,
} from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import Login from "@/pages/auth/Login";
import Onboarding from "@/pages/Onboarding";
import Dashboard from "@/pages/Dashboard";

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center">Cargando...</div>
  );
}

function RootRedirect() {
  const { user, userProfile, isAuthLoading } = useAuthStore();

  if (isAuthLoading) return <LoadingScreen />;

  if (!user) return <Navigate to="/login" replace />;

  
  if (userProfile === null) return <LoadingScreen />;

  if (!userProfile.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Navigate to="/dashboard" replace />;
}

function OnboardingGuard() {
  const { user, userProfile, isAuthLoading } = useAuthStore();

  if (isAuthLoading) return <LoadingScreen />;

  if (!user) return <Navigate to="/login" replace />;


  if (userProfile === null) return <LoadingScreen />;

  if (userProfile.onboardingCompleted) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

function ProtectedLayout() {
  const { user, userProfile, isAuthLoading } = useAuthStore();

  if (isAuthLoading) return <LoadingScreen />;

  if (!user) return <Navigate to="/login" replace />;

  
  if (userProfile === null) return <LoadingScreen />;

  if (!userProfile.onboardingCompleted) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootRedirect />,
  },
  {
    path: "/login",
    element: <Login />,
  },
  {
    element: <OnboardingGuard />,
    children: [
      {
        path: "/onboarding",
        element: <Onboarding />,
      },
    ],
  },
  {
    element: <ProtectedLayout />,
    children: [
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
