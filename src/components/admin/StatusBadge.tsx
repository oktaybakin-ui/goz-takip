"use client";

import React from "react";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  in_progress: { label: "Devam Ediyor", className: "bg-yellow-900/50 text-yellow-300 border-yellow-700" },
  completed: { label: "Tamamlandı", className: "bg-green-900/50 text-green-300 border-green-700" },
  calibration_failed: { label: "Kalibrasyon Başarısız", className: "bg-red-900/50 text-red-300 border-red-700" },
  abandoned: { label: "Terk Edildi", className: "bg-gray-800 text-gray-400 border-gray-600" },
};

interface StatusBadgeProps {
  status: string;
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.in_progress;
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs border ${config.className}`}>
      {config.label}
    </span>
  );
}
