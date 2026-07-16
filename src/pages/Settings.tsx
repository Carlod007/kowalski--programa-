import { Link } from "react-router-dom";
import { useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { updateUserProfile } from "@/services/userService";

function ProfileSection() {
  const { user, userProfile, setUserProfile } = useAuthStore();
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(userProfile?.name ?? "");
  const [saving, setSaving] = useState(false);

  if (!user || !userProfile) return null;

  const currentUser = user;
  const currentProfile = userProfile;

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (trimmed === "" || trimmed === currentProfile.name) {
      setEditingName(false);
      return;
    }
    setSaving(true);
    try {
      await updateUserProfile(currentUser.uid, { name: trimmed });
      setUserProfile({ ...currentProfile, name: trimmed });
      setEditingName(false);
    } catch (err) {
      console.error("Error al actualizar nombre:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-5 mt-6">
      <h2 className="text-xs font-medium uppercase tracking-wide text-stone-400">
        Perfil
      </h2>
      <div className="mt-2 divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-stone-900">Nombre</span>
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                disabled={saving}
                autoFocus
                className="w-32 rounded-lg border border-stone-300 px-2 py-1 text-sm outline-none"
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={saving}
                className="text-xs font-medium text-teal-600"
              >
                Guardar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNameInput(userProfile.name);
                setEditingName(true);
              }}
              className="text-sm text-stone-500"
            >
              {userProfile.name}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-stone-900">Correo</span>
          <span className="text-sm text-stone-400">{userProfile.email}</span>
        </div>

        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-stone-900">Contraseña</span>
          <span className="text-sm tracking-widest text-stone-400">
            ••••••••
          </span>
        </div>
      </div>
    </section>
  );
}

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

      <ProfileSection />

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
