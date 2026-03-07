"use client";

import React, { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        setError("Kullanıcı adı veya şifre hatalı.");
        return;
      }

      router.push("/admin");
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-900 rounded-2xl p-8 w-full max-w-sm border border-gray-800 shadow-xl"
      >
        <h1 className="text-2xl font-bold text-white mb-6 text-center">Admin Girişi</h1>

        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg px-4 py-2 mb-4 text-red-300 text-sm text-center">
            {error}
          </div>
        )}

        <label className="block mb-4">
          <span className="text-gray-400 text-sm">Kullanıcı Adı</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
            required
            autoFocus
          />
        </label>

        <label className="block mb-6">
          <span className="text-gray-400 text-sm">Şifre</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
            required
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-500 disabled:opacity-50 transition"
        >
          {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
        </button>
      </form>
    </div>
  );
}
