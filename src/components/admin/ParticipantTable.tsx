"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import StatusBadge from "./StatusBadge";
import type { TestSessionWithParticipant } from "@/types/database";

export default function ParticipantTable() {
  const [sessions, setSessions] = useState<TestSessionWithParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    try {
      const res = await fetch(`/api/admin/participants?${params}`);
      if (res.ok) {
        setSessions(await res.json());
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, fromDate, toDate]);

  useEffect(() => {
    const timer = setTimeout(fetchData, 300);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const handleDelete = async (participantId: string, name: string) => {
    if (!confirm(`"${name}" adlı katılımcıyı ve tüm test verilerini silmek istediğinize emin misiniz?`)) return;

    try {
      const res = await fetch("/api/admin/participants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.participants.id !== participantId));
      }
    } catch {
      // silently fail
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-4">Katılımcılar</h2>

      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="text"
          placeholder="Ad Soyad ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">Tüm durumlar</option>
          <option value="completed">Tamamlandı</option>
          <option value="in_progress">Devam Ediyor</option>
          <option value="calibration_failed">Kalibrasyon Başarısız</option>
          <option value="abandoned">Terk Edildi</option>
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      {loading ? (
        <div className="text-gray-400">Yükleniyor...</div>
      ) : sessions.length === 0 ? (
        <div className="text-gray-500 text-center py-12 bg-gray-900 rounded-xl border border-gray-800">
          Henüz katılımcı yok.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400">
                <th className="text-left py-3 px-4">Ad Soyad</th>
                <th className="text-left py-3 px-4">Durum</th>
                <th className="text-left py-3 px-4">Tarih</th>
                <th className="text-left py-3 px-4">Foto Sayısı</th>
                <th className="text-left py-3 px-4">Kal. Hata (px)</th>
                <th className="text-left py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-gray-800/50 hover:bg-gray-900/50">
                  <td className="py-3 px-4 text-white">{s.participants.full_name}</td>
                  <td className="py-3 px-4">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="py-3 px-4 text-gray-400">
                    {new Date(s.started_at).toLocaleDateString("tr-TR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-3 px-4 text-gray-400">{s.image_count}</td>
                  <td className="py-3 px-4 text-gray-400">
                    {s.calibration_error_px?.toFixed(1) ?? "-"}
                  </td>
                  <td className="py-3 px-4 flex gap-2">
                    <Link
                      href={`/admin/participants/${s.id}`}
                      className="text-blue-400 hover:text-blue-300 text-sm"
                    >
                      Detay
                    </Link>
                    <button
                      onClick={() => handleDelete(s.participants.id, s.participants.full_name)}
                      className="text-red-500 hover:text-red-400 text-sm"
                    >
                      Sil
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-gray-600 text-xs mt-3">{sessions.length} kayıt</p>
    </div>
  );
}
