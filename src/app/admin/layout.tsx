"use client";

import React, { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  // Login page doesn't need auth check
  const isLoginPage = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginPage) {
      setAuthenticated(false);
      return;
    }
    fetch("/api/admin/me")
      .then((res) => {
        if (!res.ok) {
          router.push("/admin/login");
        } else {
          setAuthenticated(true);
        }
      })
      .catch(() => router.push("/admin/login"));
  }, [isLoginPage, router]);

  if (isLoginPage) return <>{children}</>;

  if (authenticated === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin/login");
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="text-white font-bold text-lg">
            Admin Panel
          </Link>
          <Link
            href="/admin"
            className={`text-sm ${pathname === "/admin" ? "text-blue-400" : "text-gray-400 hover:text-gray-300"}`}
          >
            Dashboard
          </Link>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-2 text-sm text-gray-400 hover:text-white transition"
        >
          Çıkış Yap
        </button>
      </nav>
      <div className="p-6">{children}</div>
    </div>
  );
}
