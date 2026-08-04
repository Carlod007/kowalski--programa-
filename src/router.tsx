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
import CloseMonth from "@/pages/CloseMonth";
import History from "@/pages/History";
import EditTransaction from "@/pages/EditTransaction";
import { lazy, Suspense } from "react";
import Settings from "@/pages/Settings";
import AdminOnboarding from "@/pages/AdminOnboarding";

const ChartsScreen = lazy(() => import("@/pages/ChartsScreen"));
const ADMIN_UID = import.meta.env.VITE_ADMIN_UID;

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

function AdminGuard() {
  const { user } = useAuthStore();
  if (!ADMIN_UID || user?.uid !== ADMIN_UID)
    return <Navigate to="/dashboard" replace />;
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
      {
        path: "/close-month",
        element: <CloseMonth />,
      },
      {
        path: "/close-month/:monthId",
        element: <CloseMonth />,
      },
      {
        path: "/history",
        element: <History />,
      },
      {
        path: "/history/edit/:monthId/:txId",
        element: <EditTransaction />,
      },
      {
        path: "/charts",
        element: (
          <Suspense
            fallback={
              <div className="flex h-dvh items-center justify-center text-stone-400">
                Cargando...
              </div>
            }
          >
            <ChartsScreen />
          </Suspense>
        ),
      },
      {
        path: "/settings",
        element: <Settings />,
      },
      {
        element: <AdminGuard />,
        children: [
          {
            path: "/admin",
            element: <AdminOnboarding />,
          },
        ],
      },
    ],
  },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
