"use client";

import React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import ParticipantDetail from "@/components/admin/ParticipantDetail";

export default function ParticipantDetailPage() {
  const params = useParams();
  const id = params.id as string;

  return (
    <div className="max-w-6xl mx-auto">
      <Link
        href="/admin"
        className="text-blue-400 hover:text-blue-300 text-sm mb-4 inline-block"
      >
        ← Dashboard
      </Link>
      <ParticipantDetail sessionId={id} />
    </div>
  );
}
