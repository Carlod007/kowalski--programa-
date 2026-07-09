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
import RegisterIncome from "@/pages/RegisterIncome";
import RegisterExpense from "@/pages/RegisterExpense";

function LoadingScreen() {
  return (
    <div className="flex h-screen items-center justify-center">Cargando...</div>
  );
}

function RootRedirect() {
  const { user, userProfile, isAuthLoading, isProfileLoading } = useAuthStore();

  if (isAuthLoading || isProfileLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!userProfile) return <Navigate to="/login" replace />;
  if (!userProfile.onboardingCompleted)
    return <Navigate to="/onboarding" replace />;
  return <Navigate to="/dashboard" replace />;
}

function LoginGuard() {
  const { user, userProfile, isAuthLoading, isProfileLoading } = useAuthStore();

  if (isAuthLoading || isProfileLoading) return <LoadingScreen />;
  if (!user) return <Outlet />;
  if (!userProfile) return <Outlet />;
  if (!userProfile.onboardingCompleted)
    return <Navigate to="/onboarding" replace />;
  return <Navigate to="/dashboard" replace />;
}

function OnboardingGuard() {
  const { user, userProfile, isAuthLoading, isProfileLoading } = useAuthStore();

  if (isAuthLoading || isProfileLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!userProfile) return <Navigate to="/login" replace />;
  if (userProfile.onboardingCompleted)
    return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}

function ProtectedLayout() {
  const { user, userProfile, isAuthLoading, isProfileLoading } = useAuthStore();

  if (isAuthLoading || isProfileLoading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  if (!userProfile) return <Navigate to="/login" replace />;
  if (!userProfile.onboardingCompleted)
    return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootRedirect />,
  },
  {
    path: "/login",
    element: <LoginGuard />,
    children: [
      {
        path: "/login",
        element: <Login />,
      },
    ],
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
      {
        path: "/income/new",
        element: <RegisterIncome />,
      },
      {
        path: "/expense/new",
        element: <RegisterExpense />,
      },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
