# Göz Takip Analizi (Eye Tracking App)

Web tabanlı göz takip ve dikkat analizi uygulaması. **1–10 fotoğraf** yükleyin; her biri 60 saniye gösterilir, webcam ile bakış noktalarınız kaydedilir. Her fotoğraf için ayrı **heatmap**, fixation analizi ve ROI kümeleme ile sonuçları inceleyin.

## Özellikler

- **21 noktalı kalibrasyon** – 16 kalibrasyon + 5 doğrulama noktası (4×4 grid + merkez/köşe) ile hassas haritalama
- **1–10 fotoğraf, 60 saniye/foto** – 1 ile 10 arası görsel; her biri 60 sn gösterilir, otomatik geçiş; foto başına ayrı heatmap
- **Canlı göz takibi** – MediaPipe Face Mesh + İris ile webcam tabanlı bakış tahmini
- **Polinom regresyon modeli** – Kalibrasyon verisiyle kişiye özel gaze modeli
- **Fixation analizi** – I-VT (velocity threshold) ile fixation/saccade ayrımı, ilk bakış, süre metrikleri
- **ROI clustering** – DBSCAN ile ilgi alanları (ROI) gruplama
- **Heatmap** – Foto başına bakış yoğunluk haritası, PNG dışa aktarma (tek tek veya tüm 10)
- **JSON export** – Tüm metrikler ve fixation verisi
- **TR/EN** – Türkçe ve İngilizce arayüz

## Gereksinimler

- Node.js 18+
- HTTPS veya localhost (tarayıcı kamera izni için)
- Webcam (tercihen 720p)

## Kurulum

```bash
npm install
```

## Çalıştırma

```bash
npm run dev
```

Tarayıcıda [http://localhost:3000](http://localhost:3000) adresini açın.

## Kullanım

1. **1–10 fotoğraf yükle** – Ana sayfada 1 ile 10 arası fotoğrafı sürükleyip bırakın veya tıklayıp çoklu seçin.
2. **Analizi başlat** – "Analizi Başlat (N foto · 60 sn/foto)" ile oturumu başlatın.
3. **Kamera izni** – Webcam erişimine izin verin.
4. **Kalibrasyon** – Ekrandaki 21 noktaya (16 + 5 doğrulama) sırayla sadece gözlerinizle bakın; başınızı sabit tutun. İsterseniz kayıtlı kalibrasyonu kullanabilirsiniz.
5. **Takibi başlat** – "Takibi Başlat" ile ilk fotoğrafta 60 sn bakış kaydı alın; süre dolunca otomatik sonraki fotoğrafa geçilir.
6. **Sonuçlar** – Tüm fotoğraflar bittikten sonra sonuç ekranında Foto 1…10 sekmeleriyle her fotoğrafın heatmap’ini, fixation ve ROI analizini inceleyin; heatmap’leri tek tek veya "Tüm 10 Heatmap İndir" ile indirin.

## Proje Yapısı

```
src/
├── app/
│   ├── layout.tsx       # Root layout, metadata, dil
│   ├── page.tsx         # Ana sayfa (10 görsel yükleme → EyeTracker)
│   ├── error.tsx        # Hata sınırı
│   ├── global-error.tsx # Kök hata
│   ├── loading.tsx      # Yükleme
│   ├── not-found.tsx    # 404
│   └── globals.css
├── components/
│   ├── Calibration.tsx  # 21 noktalı kalibrasyon UI
│   ├── EyeTracker.tsx   # Takip ekranı, 60sn geçiş, canvas overlay
│   ├── HeatmapCanvas.tsx
│   ├── ImageUploader.tsx # 10 fotoğraf yükleme
│   └── ResultsPanel.tsx  # Foto başına sonuç, heatmap indir
├── contexts/
│   └── LangContext.tsx  # TR/EN
├── lib/
│   ├── calibration.ts     # Nokta üretimi, stabilite, CalibrationManager
│   ├── calibrationStorage.ts # Kalibrasyon localStorage
│   ├── faceTracker.ts     # MediaPipe Face Mesh, iris, head pose
│   ├── fixation.ts        # I-VT fixation, DBSCAN ROI
│   ├── gazeModel.ts       # Polinom regresyon, One Euro Filter
│   ├── heatmap.ts         # Yoğunluk haritası, PNG export
│   ├── i18n.ts            # Çeviriler (TR/EN)
│   └── logger.ts          # Geliştirme logları (production’da sessiz)
├── lib/__tests__/
│   ├── gazeModel.test.ts
│   ├── fixation.test.ts
│   ├── calibration.test.ts
│   ├── heatmap.test.ts
│   └── calibrationStorage.test.ts
└── types/
    ├── mediapipe.d.ts
    └── results.ts        # ResultPerImage vb.
```

## Scriptler

| Komut            | Açıklama                    |
|------------------|-----------------------------|
| `npm run dev`    | Geliştirme sunucusu         |
| `npm run build`  | Production build            |
| `npm run start`  | Production sunucuyu başlat  |
| `npm run lint`   | ESLint                      |
| `npm run test`   | Jest unit testleri          |

## Teknolojiler

- **Next.js 14** – React framework (App Router)
- **TypeScript** – Tip güvenliği
- **Tailwind CSS** – Stil
- **MediaPipe Face Mesh** – Yüz ve iris landmark’ları
- **Polinom Ridge regresyon** – Gaze modeli (tarayıcıda)

## Notlar

- Kalibrasyon sırasında iyi aydınlatma ve sabit baş pozisyonu doğruluğu artırır.
- Gözlük kullanıyorsanız tespit bazen düşebilir; gerekirse `faceTracker.ts` içinde `minDetectionConfidence` / `minTrackingConfidence` değerlerini 0.5’e indirebilirsiniz.
- Video ve görüntü yalnızca tarayıcıda işlenir; sunucuya gönderilmez.
