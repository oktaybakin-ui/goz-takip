import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { LangProvider } from "@/contexts/LangContext";
import HtmlLangSync from "@/components/HtmlLangSync";
import { PWARegister } from "./PWARegister";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#2563eb",
};

export const metadata: Metadata = {
  title: "Göz Takip Analizi - Eye Tracking Analysis",
  description:
    "Web tabanlı göz takip ve dikkat analizi sistemi. Heatmap, fixation analizi, ROI clustering.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Göz Takip",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192x192.png" />
      </head>
      <body className={`${inter.className} bg-gray-950 text-white antialiased`}>
        <LangProvider>
          <HtmlLangSync />
          <PWARegister />
          <a
            href="#main-content"
            className="absolute left-4 top-4 -translate-y-20 focus:translate-y-0 focus:z-[100] px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium transition-transform"
          >
            İçeriğe atla
          </a>
          <main id="main-content">{children}</main>
        </LangProvider>
      </body>
    </html>
  );
}
