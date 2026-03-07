"use client";

import React, { useState } from "react";
import ImageManager from "@/components/admin/ImageManager";
import ParticipantTable from "@/components/admin/ParticipantTable";

type Tab = "images" | "participants";

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>("images");

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab("images")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === "images"
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          Görseller
        </button>
        <button
          onClick={() => setActiveTab("participants")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            activeTab === "participants"
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          Katılımcılar
        </button>
      </div>

      {activeTab === "images" && <ImageManager />}
      {activeTab === "participants" && <ParticipantTable />}
    </div>
  );
}
