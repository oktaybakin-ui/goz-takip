# Code Review & Test Raporu – Göz Takip Uygulaması

**Rol:** Kıdemli Full-Stack + Computer Vision code reviewer / test mühendisi  
**Tarih:** 2025  
**Kapsam:** Çalıştırma, build, otomatik testler, kod incelemesi ile hata tespiti ve patch.

---

## A) ÇALIŞTIRMA SONUCU

### Repo analizi
- **Klasör yapısı:** `src/app` (layout, page, error, global-error, loading, not-found), `src/components` (Calibration, EyeTracker, HeatmapCanvas, ImageUploader, ResultsPanel), `src/contexts`, `src/lib` (calibration, faceTracker, fixation, gazeModel, heatmap, i18n, logger, calibrationStorage), `src/lib/__tests__`, `src/types`.
- **Stack:** Next.js 14, React 18, TypeScript 5, Tailwind CSS 3, MediaPipe Face Mesh, ml-regression-polynomial, ml-matrix.
- **Komutlar:** `npm run dev` (dev server), `npm run build` (production build), `npm run start`, `npm run lint`, `npm run test` (Jest).
- **Env:** `.env.example` mevcut; zorunlu değişken yok. Kamera için HTTPS veya localhost gerekir.

### Build
- **İlk build:** **FAIL** – Type error: `Block-scoped variable 'stopTracking' used before its declaration` (`EyeTracker.tsx` satır 388).
- **Düzeltme sonrası:** **PASS** – `next build` sorunsuz tamamlandı.

### Dev server
- Ortam kısıtı (path encoding, tarayıcı erişimi) nedeniyle `npm run dev` ile canlı sayfa testi yapılmadı. Build ve Jest çalıştırıldı.

### Lint
- `npm run lint` etkileşimli ESLint kurulumu istiyor; yapılandırma tamamlanmadı. `next build` içindeki type-check geçti.

---

## B) TEST SONUÇLARI

### Otomatik testler (Jest)
| Suite | Sonuç |
|-------|--------|
| gazeModel.test.ts | PASS |
| fixation.test.ts | PASS |
| calibration.test.ts | PASS (yeni eklendi) |
| calibrationStorage.test.ts | PASS (yeni eklendi) |
| heatmap.test.ts | PASS (yeni eklendi) |

**Toplam:** 5 suite, 26 test, hepsi geçti.

### Manuel test senaryoları (kod incelemesi ile değerlendirme)

| Test | Sonuç | Not |
|------|--------|-----|
| **TEST 1 – Kamera başlatma** | REVIEW | FaceTracker `initialize` try/catch ile hata ayrıştırıyor; stream `destroy()` ile kapatılıyor. Gerçek ortamda izin/cihaz testi yapılmadı. |
| **TEST 2 – Gaze veri akışı** | PASS (unit) | Mock gaze/fixation ile heatmap render testi eklendi; null/undefined için EyeTracker’da `predict` null dönünce nokta eklenmiyor, crash yok. |
| **TEST 3 – 10 fotoğraf akışı** | REVIEW | Foto değişiminde `gazePointsRef.current = []`, yeni `FixationDetector`, `gazePointsByImageRef.current[idx]` ile per-image kayıt. Index 0..9 sınırları korunuyor. |
| **TEST 4 – Koordinat doğrulama** | REVIEW | `screenToImageCoords` letterbox/pillarbox ile hesaplıyor; container resize’da `getImageRect()` her frame güncel. Gerçek ekranda görsel doğrulama yapılmadı. |
| **TEST 5 – Heatmap üretimi** | PASS (unit) | HeatmapGenerator render (gaze + fixation) testte; export için 0x0 boyut koruması ResultsPanel’e eklendi. |
| **TEST 6 – Export** | REVIEW | Dosya adı `heatmap-foto-${index + 1}.png`; 0x0 dimensions export’ta atlanıyor. JSON export tek görüntü akışında; 10 foto akışında panel heatmap export kullanıyor. |

---

## C) KRİTİK HATALAR

| # | Dosya | Satır | Kök neden |
|---|--------|--------|-----------|
| 1 | `src/components/EyeTracker.tsx` | 388 | `useEffect` dependency array’de `stopTracking` kullanılıyor; `stopTracking` aynı dosyada daha aşağıda `useCallback` ile tanımlı. Block-scoped değişken tanımlanmadan kullanılamaz. |

---

## D) PATCH

### 1) EyeTracker.tsx – `stopTracking` kullanım sırası
**Sorun:** `stopTracking` dependency’de kullanılıyor ama sonra tanımlanıyor.  
**Çözüm:** `stopTracking` tanımını, kendisini kullanan `useEffect`’in (klavye kısayolları) üstüne taşımak.

```diff
  }, [imageDimensions, imageNaturalDimensions, getImageRect]);

+  // Tracking durdur
+  const stopTracking = useCallback(() => {
+    setIsTracking(false);
+    if (trackingTimerRef.current) {
+      clearInterval(trackingTimerRef.current);
+      trackingTimerRef.current = null;
+    }
+    fixationDetectorRef.current.stopTracking();
+    faceTrackerRef.current.stopTracking();
+    const results = fixationDetectorRef.current.getMetrics();
+    setMetrics(results);
+    setPhase("results");
+  }, []);
+
   // Klavye kısayolları (takip ekranında)
   useEffect(() => {
     ...
   }, [phase, isTracking, startTracking, stopTracking]);

-  // Tracking durdur
-  const stopTracking = useCallback(() => { ... }, []);

   // Drift düzeltme
```

### 2) ResultsPanel.tsx – Heatmap export 0x0 koruması
**Sorun:** `imageDimensions` 0x0 olursa canvas/export hataları olabilir.  
**Çözüm:** Export öncesi `width`/`height` kontrolü.

```diff
   const handleExportHeatmapForPhoto = (index: number) => {
     if (!resultsPerImage?.[index]) return;
     const result = resultsPerImage[index];
+    const w = result.imageDimensions?.width ?? 0;
+    const h = result.imageDimensions?.height ?? 0;
+    if (w <= 0 || h <= 0) return;
     setExportingHeatmapIndex(index);
     const img = new Image();
     img.onload = () => {
       const dataUrl = heatmapGeneratorRef.current.exportToPNG(
         result.gazePoints,
         result.fixations,
         img,
-        result.imageDimensions.width,
-        result.imageDimensions.height
+        w,
+        h
       );
       ...
     };
```

### 3) Yeni unit testler
- **calibration.test.ts:** `generateCalibrationPoints` (16 nokta, padding), `generateValidationPoints` (5 nokta), `checkStability` (düşük confidence / göz açıklığı).
- **calibrationStorage.test.ts:** `saveCalibration`, `loadCalibration`, `hasStoredCalibration`, `clearCalibration` (mock `localStorage`).
- **heatmap.test.ts:** HeatmapGenerator oluşturma, `updateConfig`, boş/mock gaze ve fixation ile `render` (document yoksa atlanıyor).

---

## E) TEKRAR TEST SONUCU

| Kontrol | Sonuç |
|---------|--------|
| `npm run build` | PASS |
| `npm run test` | PASS (5 suite, 26 test) |

---

## F) AÇIK KALAN RİSKLER

1. **Kamera / izin:** Gerçek ortamda kamera reddi veya cihaz yok senaryosu manuel test edilmedi.
2. **Bellek:** Uzun süre açık kalma ve stream/interval temizliği gerçek tarayıcıda profil ile doğrulanmadı.
3. **10 foto erken çıkış:** Kullanıcı 10 foto bitmeden “Yeni Görüntü” veya sayfadan ayrılırsa kısmi veri kaybı; ürün kararı değiştirilmedi.
4. **Sekme değişimi:** Page Visibility ile takip duraklatma/uyarı yok; sekme değişince timer devam ediyor.
5. **ESLint:** Etkileşimli kurulum tamamlanmadığı için proje bazlı lint kuralları uygulanmıyor.

---

## Özet

- **Kritik build hatası** giderildi (`stopTracking` sırası).
- **Export güvenliği** artırıldı (0x0 heatmap export engellendi).
- **Otomatik testler** genişletildi (calibration, calibrationStorage, heatmap) ve hepsi geçiyor.
- Dev server ve gerçek tarayıcı/kamera ile manuel testler ortam kısıtı nedeniyle yapılmadı; senaryolar kod incelemesi ile REVIEW olarak işaretlendi.
