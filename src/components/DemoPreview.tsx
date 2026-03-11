"use client";

import React from "react";

/**
 * Kullanıcılara göz takip testinin nasıl çalıştığını gösteren
 * interaktif demo/örnek görsel. Kayıt sayfasında gösterilir.
 */
export default function DemoPreview() {
  return (
    <div className="w-full max-w-sm mx-auto mt-6">
      <div className="bg-gray-900/60 rounded-2xl border border-gray-800 p-4">
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3 text-center">
          Nasıl Çalışır?
        </p>

        {/* Demo görsel — simüle edilmiş heatmap */}
        <div className="relative rounded-xl overflow-hidden bg-gray-800 aspect-[4/3]">
          {/* Arka plan gradient — yüz benzeri */}
          <svg
            viewBox="0 0 400 300"
            className="w-full h-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Koyu arka plan */}
            <rect width="400" height="300" fill="#1a1a2e" />

            {/* Simüle yüz fotoğrafı alanı */}
            <rect x="50" y="20" width="300" height="260" rx="16" fill="#252540" />

            {/* Yüz silüeti */}
            <ellipse cx="200" cy="130" rx="70" ry="85" fill="#2d2d4a" />
            {/* Saç */}
            <ellipse cx="200" cy="70" rx="75" ry="50" fill="#1e1e36" />
            {/* Gözler */}
            <ellipse cx="175" cy="120" rx="14" ry="8" fill="#3a3a5c" />
            <ellipse cx="225" cy="120" rx="14" ry="8" fill="#3a3a5c" />
            {/* Göz bebekleri */}
            <circle cx="178" cy="120" r="4" fill="#555580" />
            <circle cx="228" cy="120" r="4" fill="#555580" />
            {/* Burun */}
            <line x1="200" y1="128" x2="200" y2="150" stroke="#3a3a5c" strokeWidth="2" />
            {/* Ağız */}
            <path d="M185,165 Q200,175 215,165" fill="none" stroke="#3a3a5c" strokeWidth="2" />

            {/* Heatmap overlay — sıcak bölgeler */}
            <defs>
              <radialGradient id="heat1" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.7" />
                <stop offset="40%" stopColor="#f97316" stopOpacity="0.4" />
                <stop offset="70%" stopColor="#eab308" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#eab308" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="heat2" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.5" />
                <stop offset="50%" stopColor="#f97316" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#eab308" stopOpacity="0" />
              </radialGradient>
              <radialGradient id="heat3" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#f97316" stopOpacity="0.4" />
                <stop offset="60%" stopColor="#eab308" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* Ana odak — gözler bölgesi */}
            <ellipse cx="200" cy="120" rx="60" ry="35" fill="url(#heat1)" />
            {/* İkincil odak — ağız bölgesi */}
            <ellipse cx="200" cy="160" rx="35" ry="25" fill="url(#heat2)" />
            {/* Üçüncül odak — alın */}
            <ellipse cx="200" cy="85" rx="30" ry="20" fill="url(#heat3)" />

            {/* Gaze noktaları — küçük bakış izleri */}
            <circle cx="180" cy="118" r="3" fill="#ef4444" opacity="0.6" />
            <circle cx="220" cy="122" r="3" fill="#ef4444" opacity="0.5" />
            <circle cx="195" cy="115" r="2.5" fill="#f97316" opacity="0.5" />
            <circle cx="205" cy="125" r="2" fill="#f97316" opacity="0.4" />
            <circle cx="200" cy="155" r="2.5" fill="#eab308" opacity="0.4" />
            <circle cx="190" cy="162" r="2" fill="#eab308" opacity="0.3" />
            <circle cx="210" cy="158" r="2" fill="#eab308" opacity="0.35" />
            <circle cx="200" cy="90" r="2" fill="#22c55e" opacity="0.3" />

            {/* Saccade çizgileri — bakış yolu */}
            <polyline
              points="180,118 195,115 220,122 205,125 200,155 190,162 200,90 210,158"
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="1"
              strokeDasharray="3,3"
            />

            {/* Etiketler */}
            <text x="330" y="45" fill="#9ca3af" fontSize="10" textAnchor="end" fontFamily="sans-serif">Isı Haritası</text>

            {/* Sıcaklık skalası */}
            <defs>
              <linearGradient id="scaleGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="50%" stopColor="#f97316" />
                <stop offset="100%" stopColor="#22c55e" />
              </linearGradient>
            </defs>
            <rect x="355" y="55" width="10" height="80" rx="5" fill="url(#scaleGrad)" opacity="0.7" />
            <text x="370" y="62" fill="#9ca3af" fontSize="8" fontFamily="sans-serif">Çok</text>
            <text x="370" y="138" fill="#9ca3af" fontSize="8" fontFamily="sans-serif">Az</text>
          </svg>

          {/* "Örnek" badge */}
          <div className="absolute top-2 left-2 bg-blue-600/90 text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded-full">
            Örnek Sonuç
          </div>
        </div>

        {/* Açıklama adımları */}
        <div className="mt-4 space-y-2.5">
          <StepItem
            number="1"
            title="Kalibrasyon"
            desc="Ekrandaki noktalara bakarak sistem gözlerinizi tanır."
            color="text-blue-400"
          />
          <StepItem
            number="2"
            title="Görsellere Bakma"
            desc="Her görsel 20 sn gösterilir, kamera bakışınızı izler."
            color="text-yellow-400"
          />
          <StepItem
            number="3"
            title="Sonuçlar"
            desc="Isı haritası, odaklanma analizi ve bakış yolu görüntülenir."
            color="text-green-400"
          />
        </div>
      </div>
    </div>
  );
}

function StepItem({ number, title, desc, color }: { number: string; title: string; desc: string; color: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className={`w-5 h-5 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0 mt-0.5 ${color} text-xs font-bold`}>
        {number}
      </div>
      <div>
        <p className={`text-sm font-semibold ${color}`}>{title}</p>
        <p className="text-gray-500 text-xs leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
