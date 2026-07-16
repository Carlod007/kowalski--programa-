import { Link } from "react-router-dom";
import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function Settings() {
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Error al cerrar sesión:", err);
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-dvh bg-stone-50 pb-8">
      <header className="flex items-center gap-3 px-5 pt-8">
        <Link to="/dashboard" className="text-lg text-stone-500">
          ←
        </Link>
        <h1 className="text-xl font-semibold text-stone-900">Configuración</h1>
      </header>

      <div className="mt-8 px-5">
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full rounded-2xl border border-red-200 bg-red-50 py-3 text-sm font-medium text-red-600 disabled:opacity-40"
        >
          {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
        </button>
      </div>
    </div>
  );
}
