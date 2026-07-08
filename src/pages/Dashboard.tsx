import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { checkAndCloseMonth } from "@/services/monthService";
import { getMonthId } from "@/utils/date";
import { formatCents } from "@/utils/currency";
import type { Month } from "@/types/month";
import type { Category } from "@/types/transaction";

const CATEGORY_ORDER: Category[] = ["necesidad", "ocio", "ahorro"];

const CATEGORY_META: Record<
  Category,
  { label: string; bar: string; text: string; bg: string }
> = {
  necesidad: {
    label: "Necesidad",
    bar: "bg-amber-500",
    text: "text-amber-700",
    bg: "bg-amber-50",
  },
  ocio: {
    label: "Ocio",
    bar: "bg-blue-500",
    text: "text-blue-700",
    bg: "bg-blue-50",
  },
  ahorro: {
    label: "Ahorro",
    bar: "bg-teal-500",
    text: "text-teal-700",
    bg: "bg-teal-50",
  },
};

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const [month, setMonth] = useState<Month | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    checkAndCloseMonth(user.uid).catch((err) => {
      console.error("checkAndCloseMonth falló:", err);
    });

    const monthRef = doc(db, "users", user.uid, "months", getMonthId());
    const unsubscribe = onSnapshot(
      monthRef,
      (snap) => {
        setMonth(snap.exists() ? (snap.data() as Month) : null);
        setLoading(false);
      },
      (err) => {
        console.error("onSnapshot mes falló:", err);
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [user]);

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center text-stone-400">
        Cargando mes...
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-stone-50 pb-28">
      <header className="px-5 pt-8 pb-4">
        <p className="text-sm text-stone-500">Este mes</p>
        <h1 className="text-2xl font-semibold text-stone-900">
          {formatCents(month?.totalIncomeCents ?? 0)} ingresados
        </h1>
      </header>

      <main className="flex flex-col gap-3 px-5">
        {CATEGORY_ORDER.map((cat) => (
          <CategoryCard key={cat} category={cat} month={month} />
        ))}
      </main>

      <div className="fixed bottom-24 right-5 flex flex-col gap-3">
        <Link
          to="/expense/new"
          aria-label="Registrar egreso"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-900 text-2xl text-white shadow-lg active:scale-95"
        >
          −
        </Link>
        <Link
          to="/income/new"
          aria-label="Registrar ingreso"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-2xl text-white shadow-lg active:scale-95"
        >
          +
        </Link>
      </div>

      <BottomNav />
    </div>
  );
}

function CategoryCard({
  category,
  month,
}: {
  category: Category;
  month: Month | null;
}) {
  const meta = CATEGORY_META[category];
  const cap = month?.capsCents[category] ?? 0;
  const spent = month?.spentCents[category] ?? 0;
  const disponible = cap - spent;

  if (cap === 0) {
    return (
      <div className={`rounded-2xl border border-stone-200 ${meta.bg} p-4`}>
        <p className={`text-sm font-medium ${meta.text}`}>{meta.label}</p>
        <p className="mt-1 text-sm text-stone-500">
          Aún sin ingresos registrados
        </p>
      </div>
    );
  }

  const isLow = disponible <= cap * 0.15;
  const overCap = spent > cap;
  const barWidth = Math.min(100, Math.max(0, (spent / cap) * 100));

  return (
    <div className={`rounded-2xl border border-stone-200 ${meta.bg} p-4`}>
      <div className="flex items-center justify-between">
        <p className={`text-sm font-medium ${meta.text}`}>{meta.label}</p>
        {overCap && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
            Excedido
          </span>
        )}
      </div>

      <p
        className={`mt-1 text-xl font-semibold ${isLow ? "text-red-600" : "text-stone-900"}`}
      >
        {formatCents(disponible)}
        <span className="ml-1 text-sm font-normal text-stone-400">
          disponible
        </span>
      </p>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-stone-200">
        <div
          className={`h-full rounded-full ${overCap ? "bg-red-500" : meta.bar}`}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <p className="mt-1 text-xs text-stone-400">
        {formatCents(spent)} de {formatCents(cap)}
      </p>
    </div>
  );
}

function BottomNav() {
  const items = [
    { to: "/dashboard", label: "Inicio" },
    { to: "/history", label: "Historial" },
    { to: "/charts", label: "Análisis" },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 flex border-t border-stone-200 bg-white">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex-1 py-3 text-center text-sm ${isActive ? "font-medium text-teal-700" : "text-stone-500"}`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
