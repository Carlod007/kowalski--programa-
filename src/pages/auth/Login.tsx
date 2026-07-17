// src/pages/auth/Login.tsx
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { createUserProfile } from "@/services/userService";
import { useAuthStore } from "@/store/authStore";

const loginSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
});

const registerSchema = z.object({
  name: z.string().trim().min(2, "Mínimo 2 caracteres"),
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(6, "Mínimo 6 caracteres"),
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

export default function Login() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const { setUserProfile } = useAuthStore();

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const registerForm = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
  });

  async function handleLogin(data: LoginForm) {
    try {
      setError(null);
      await signInWithEmailAndPassword(auth, data.email, data.password);
    } catch {
      setError("Email o contraseña incorrectos");
    }
  }

  async function handleRegister(data: RegisterForm) {
    try {
      setError(null);
      const { user } = await createUserWithEmailAndPassword(
        auth,
        data.email,
        data.password,
      );
      const profile = await createUserProfile(user.uid, {
        name: data.name,
        email: data.email,
      });
      setUserProfile(profile);
    } catch {
      setError("Error al crear la cuenta. Intenta con otro email");
    }
  }

  async function handleForgotPassword() {
    const email = loginForm.getValues("email");
    if (!email || !z.string().email().safeParse(email).success) {
      setResetError("Escribe tu email arriba primero");
      return;
    }
    setResetError(null);
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
    } catch {
      setResetError("No se pudo enviar el correo. Verifica el email");
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-medium">Kowalski</h1>

        {/* Tabs */}
        <div className="mb-6 flex">
          <button
            className={`flex-1 border-b-2 pb-2 text-sm ${
              tab === "login"
                ? "border-teal-600 font-medium text-teal-600"
                : "border-gray-200 text-gray-400"
            }`}
            onClick={() => {
              setTab("login");
              setError(null);
            }}
          >
            Iniciar sesión
          </button>
          <button
            className={`flex-1 border-b-2 pb-2 text-sm ${
              tab === "register"
                ? "border-teal-600 font-medium text-teal-600"
                : "border-gray-200 text-gray-400"
            }`}
            onClick={() => {
              setTab("register");
              setError(null);
            }}
          >
            Registrarse
          </button>
        </div>

        {/* Error global */}
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </p>
        )}

        {/* Login form */}
        {tab === "login" && (
          <form
            onSubmit={loginForm.handleSubmit(handleLogin)}
            className="flex flex-col gap-4"
          >
            <div>
              <label className="mb-1 block text-xs text-gray-600">Email</label>
              <input
                {...loginForm.register("email")}
                type="email"
                placeholder="tu@email.com"
                className="w-full rounded-lg bg-gray-50 px-3 py-3 text-sm outline-none"
              />
              {loginForm.formState.errors.email && (
                <p className="mt-1 text-xs text-red-500">
                  {loginForm.formState.errors.email.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">
                Contraseña
              </label>
              <input
                {...loginForm.register("password")}
                type="password"
                placeholder="••••••"
                className="w-full rounded-lg bg-gray-50 px-3 py-3 text-sm outline-none"
              />
              {loginForm.formState.errors.password && (
                <p className="mt-1 text-xs text-red-500">
                  {loginForm.formState.errors.password.message}
                </p>
              )}
            </div>
            <div className="text-right">
              {resetSent ? (
                <p className="text-xs text-teal-600">
                  Revisa tu correo para restablecer tu contraseña
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs text-gray-500 underline"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              )}
              {resetError && (
                <p className="mt-1 text-xs text-red-500">{resetError}</p>
              )}
            </div>
            <button
              type="submit"
              disabled={loginForm.formState.isSubmitting}
              className="mt-2 rounded-lg bg-teal-600 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {loginForm.formState.isSubmitting
                ? "Entrando..."
                : "Iniciar sesión"}
            </button>
          </form>
        )}

        {/* Register form */}
        {tab === "register" && (
          <form
            onSubmit={registerForm.handleSubmit(handleRegister)}
            className="flex flex-col gap-4"
          >
            <div>
              <label className="mb-1 block text-xs text-gray-600">Nombre</label>
              <input
                {...registerForm.register("name")}
                type="text"
                placeholder="Tu nombre"
                className="w-full rounded-lg bg-gray-50 px-3 py-3 text-sm outline-none"
              />
              {registerForm.formState.errors.name && (
                <p className="mt-1 text-xs text-red-500">
                  {registerForm.formState.errors.name.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Email</label>
              <input
                {...registerForm.register("email")}
                type="email"
                placeholder="tu@email.com"
                className="w-full rounded-lg bg-gray-50 px-3 py-3 text-sm outline-none"
              />
              {registerForm.formState.errors.email && (
                <p className="mt-1 text-xs text-red-500">
                  {registerForm.formState.errors.email.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">
                Contraseña
              </label>
              <input
                {...registerForm.register("password")}
                type="password"
                placeholder="••••••"
                className="w-full rounded-lg bg-gray-50 px-3 py-3 text-sm outline-none"
              />
              {registerForm.formState.errors.password && (
                <p className="mt-1 text-xs text-red-500">
                  {registerForm.formState.errors.password.message}
                </p>
              )}
            </div>
            <button
              type="submit"
              disabled={registerForm.formState.isSubmitting}
              className="mt-2 rounded-lg bg-teal-600 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {registerForm.formState.isSubmitting
                ? "Creando cuenta..."
                : "Registrarse"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
