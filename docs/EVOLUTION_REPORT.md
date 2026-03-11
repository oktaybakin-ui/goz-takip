# Göz Takip Sistemi — Evrim Raporu
## Phase 1-4: Derin Analiz, SOTA Araştırması, Altın Standart Model ve Boşluk Analizi

---

## PHASE 1: MEVCUT SİSTEM DERİN ANALİZİ

### 1.1 Mimari Genel Bakış

**Teknoloji**: Next.js 14 + React 18 + TypeScript + Tailwind CSS
**Bilgisayar Görüşü**: MediaPipe Face Mesh (478 landmark, 10 iris noktası)
**Gaze Model**: Polinom regresyon (selective 2nd/3rd degree, ~80 özellik)
**Smoothing**: One Euro Filter (tek katman, adaptif)
**Fixation**: I-VT (velocity threshold) + DBSCAN clustering
**Workers**: 3 Web Worker (model eğitim, heatmap colorize, DBSCAN)
**Kalibrasyon**: 16 nokta (4×4 grid, serpantin sıra) + 9 doğrulama noktası

### 1.2 Pipeline Akışı

```
Kamera → MediaPipe FaceMesh → Iris Tespiti (AdvancedIrisDetector)
  → EyeFeatures Çıkarımı → GazeModel (Polinom Regresyon)
    → One Euro Filter → Drift/Affine Correction → GazePoint
      → FixationDetector (I-VT) → HeatmapGenerator
```

### 1.3 Güçlü Yönler

1. **Sofistike Iris Tespiti**: Kåsa least-squares circle fit + temporal smoothing — deterministik, kararlı
2. **Akıllı Feature Engineering**: Yaw-aware iris weighting (kameraya yakın göze daha çok güven)
3. **One Euro Filter**: Çift filtreleme hatası düzeltilmiş — tek katman, velocity-adaptive
4. **Polinom Özellik Seçimi**: 237 yerine ~80 selective özellik (overfitting riski azaltılmış)
5. **LOGO-CV Lambda Seçimi**: Leave-One-Group-Out cross-validation ile otomatik regularization
6. **Weighted Ridge Regression**: Confidence + spatial weighting (kenar noktalar ek ağırlık)
7. **Residual Cleanup**: Eğitim sonrası en yüksek hatalı %12 örnek atılıp yeniden eğitim
8. **Afin Düzeltme**: Doğrulama sonrası 6 parametreli affine correction (ölçek+döndürme+öteleme)
9. **Multi-Model Ensemble**: 3 model (farklı lambda + örnekleme stratejileri) ağırlıklı ortalama
10. **Göz Bölgesi Zoom**: Yüksek çözünürlük kameralarda göz bölgesini kırpıp büyütme
11. **Web Worker Offloading**: Ağır hesaplamalar UI thread'ini bloklamıyor
12. **PWA Desteği**: Service worker, offline fallback, app manifest
13. **Quality Score**: Veri kalitesi değerlendirme (ekran oranı, örnekleme hızı, bütünlük)
14. **Auto-Recalibration**: Click-fixation korelasyonu ile implicit kalibrasyon
15. **Gaze Replay**: Bakış yolunu zaman çizelgesiyle yeniden izleme

### 1.4 Zayıf Yönler ve Sınırlamalar

#### Algoritmik
1. **Polinom regresyon sınırı**: Non-linear gaze mapping için sadece 2.-3. derece polinom kullanılıyor. Deep learning tabanlı modellere kıyasla sınırlı temsil kapasitesi.
2. **Head pose compensation yetersiz**: Sadece yaw-aware iris weighting var; tam 3D head-gaze decomposition yok.
3. **Blink detection basit**: Sadece EAR < 0.18 eşiği; consecutive frame kontrolü yok, blink süresi/sayısı metriği yok.
4. **Fixation detection I-VT**: 30 Hz webcam'de velocity hesabı gürültülü. I-DT (dispersion-based) daha kararlı olurdu.
5. **Saccade detection zayıf**: Sadece velocity threshold; acceleration threshold yok, Engbert-Kliegl adaptif yöntem yok.
6. **Ensemble predict sorunlu**: Her model kendi One Euro Filter'ına sahip → 3 ayrı smoothing → birleştirilmiş sonuç tutarsız olabilir.

#### Mimari
7. **EyeTracker.tsx monolitik**: 1299 satır tek bileşen — kalibrasyon, tracking, sonuç yönetimi hepsi burada.
8. **Feature extraction tightly coupled**: faceTracker.ts hem kamera yönetimi hem iris tespiti hem pose estimation yapıyor.
9. **Kalibrasyon verisi volatile**: Sayfa yenilenince kalibrasyon kayboluyor (localStorage'a model kaydı var ama kullanılmıyor).
10. **Worker factory basit**: createInlineWorker her seferinde yeni Worker oluşturuyor, pool yok.

#### Performans
11. **Gauss elimination O(n³)**: Ridge regression çözümü büyük feature matrisleri için yavaş.
12. **Heatmap colorize sync fallback**: Worker başarısız olursa main thread'de pixel-by-pixel işlem yapılıyor.
13. **DBSCAN O(n²)**: Fixation sayısı çok olunca kümeleme yavaşlayabilir.

#### Eksik Özellikler
14. **Benchmark/accuracy testing framework yok**: Gaze doğruluğunu sistematik ölçecek araç yok.
15. **Dataset export sınırlı**: CSV var ama standart format (Tobii, EyeLink uyumlu) yok.
16. **Attention analysis yok**: Fixation süresi/sayısı var ama AOI (Area of Interest) analizi yok.
17. **Gaze path visualization**: ResultsPanel'de fixation plot var ama scanpath analysis yok.

---

## PHASE 2: DÜNYA ÇAPINDA SOTA ARAŞTIRMASI (Özet)

### En İyi Sistemler ve Önemli Teknikler

| Sistem/Yöntem | Teknik | Doğruluk |
|---|---|---|
| WebGazer.js | Ridge regression + 120-dim eye patches | ~4° (~175px) |
| Pupil Labs (pye3d) | 3D eye model + refraction correction | 1.5-2.5° |
| iTracker/GazeCapture | Multi-branch CNN (face+eyes+grid) | 1.71cm (phone) |
| GazeTR-Hybrid | ResNet-18 + 6-layer Transformer | 4.00° (MPIIFaceGaze) |
| FAZE (NVIDIA) | MAML meta-learning, 3 calibration points | 3.18° |
| One Euro Filter | Adaptive low-pass, 135x faster than Kalman | N/A |
| I-DT Fixation | Dispersion threshold, webcam'e daha uygun | N/A |
| EAR Blink | threshold=0.2, consec_frames=3 | 92-97% acc |

### Önemli Bulgular
- **One Euro > Kalman** gaze smoothing için (daha az lag, daha basit, 135x hızlı)
- **I-DT > I-VT** düşük frekanslı webcam'lerde (30 Hz'de velocity gürültülü)
- **Ridge regression** az kalibrasyonlu ortamda en iyi (5-20 nokta)
- **HDBSCAN > DBSCAN** değişken yoğunluklu clustering için
- **Affine calibration** düzeltmesi standart yaklaşım (3+ doğrulama noktası)
- **WebGazer's histogram-equalized eye patches** ek feature olarak çok etkili

---

## PHASE 3: ALTIN STANDART MODEL

### İdeal Göz Takip Sistemi Mimarisi

```
┌─────────────────────────────────────────────────┐
│                 KAMERA GİRİŞİ                    │
│         (1080p/720p, 30+ FPS, WebRTC)           │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│         YÜZ TESPİT MOTORU                        │
│  MediaPipe Face Mesh (478 landmark + 10 iris)    │
│  + Eye Region Zoom (yüksek çözünürlüklü crop)   │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│       ÖZELLİK ÇIKARIM KATMANI                   │
│  ┌─────────────┐  ┌──────────────┐               │
│  │ Iris Tespiti │  │ Head Pose    │               │
│  │ (LS Circle  │  │ Estimation   │               │
│  │  + Ellipse) │  │ (6DoF)       │               │
│  └──────┬──────┘  └──────┬───────┘               │
│         │                │                        │
│  ┌──────▼──────┐  ┌──────▼───────┐               │
│  │ Iris Rel.   │  │ EAR + Blink  │               │
│  │ Position    │  │ Detection    │               │
│  └──────┬──────┘  └──────┬───────┘               │
│         └────────┬───────┘                        │
│                  ▼                                │
│         EyeFeatures (16-dim)                     │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│         BAKIŞ TAHMİN MOTORU                      │
│  ┌─────────────────────────────────┐              │
│  │ Primary: Polynomial Ridge      │              │
│  │ Regression (~80 selective      │              │
│  │ features, LOGO-CV lambda)      │              │
│  └──────────────┬──────────────────┘              │
│                 │                                 │
│  ┌──────────────▼──────────────────┐              │
│  │ Smoothing: One Euro Filter     │              │
│  │ (velocity-adaptive params)     │              │
│  └──────────────┬──────────────────┘              │
│                 │                                 │
│  ┌──────────────▼──────────────────┐              │
│  │ Correction: Affine Transform   │              │
│  │ + Continuous Drift Correction  │              │
│  └──────────────┬──────────────────┘              │
│                 ▼                                 │
│         GazePoint (x, y, t, conf)                │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│         OLAY TESPİT MOTORU                       │
│  ┌────────────┐ ┌───────────┐ ┌──────────────┐   │
│  │ Fixation   │ │ Saccade   │ │ Blink        │   │
│  │ (I-DT +   │ │ (Velocity │ │ (EAR +       │   │
│  │ I-VT      │ │ + Accel   │ │ Consecutive  │   │
│  │ Hybrid)   │ │ Threshold)│ │ Frames)      │   │
│  └─────┬──────┘ └─────┬─────┘ └──────┬───────┘   │
│        └───────┬───────┘              │           │
│                ▼                      │           │
│  ┌──────────────────────┐             │           │
│  │ ROI Clustering       │             │           │
│  │ (DBSCAN/HDBSCAN)     │◄───────────┘           │
│  └──────────────────────┘                         │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│         KALİBRASYON SİSTEMİ                      │
│  ┌───────────────────┐ ┌─────────────────────┐    │
│  │ Explicit: N-point │ │ Implicit: Click     │    │
│  │ + Validation      │ │ correlation +       │    │
│  │ + Affine correct  │ │ UI element tracking │    │
│  └───────────────────┘ └─────────────────────┘    │
│  ┌───────────────────────────────────────────┐    │
│  │ Adaptive Recalibration                    │    │
│  │ (head movement → trigger recalibration)   │    │
│  └───────────────────────────────────────────┘    │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│         ANALİZ & GÖRSELLEŞTİRME                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Heatmap  │ │ Scanpath │ │ Attention Map    │  │
│  │ (Gauss   │ │ (Fixation│ │ (AOI + Duration  │  │
│  │  blur +  │ │  + Saccade│ │  weighting)     │  │
│  │  color)  │ │  arrows) │ │                  │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
│  ┌──────────────────────────────────────────┐     │
│  │ Metrics: TTFF, Fixation Count, Duration, │     │
│  │ Saccade Amplitude, Blink Rate, ROI       │     │
│  └──────────────────────────────────────────┘     │
└─────────────┬───────────────────────────────────┘
              │
┌─────────────▼───────────────────────────────────┐
│         VERİ DIŞA AKTARMA                        │
│  CSV | JSON | PNG Heatmap | Research Dataset     │
│  (Tobii-compatible format)                       │
└──────────────────────────────────────────────────┘
```

---

## PHASE 4: BOŞLUK ANALİZİ (Gap Analysis)

### Öncelik Sırasına Göre İyileştirmeler

#### P0 — Kritik (Doğruluğu Doğrudan Etkiler)

| # | Boşluk | Mevcut | Hedef | Etki |
|---|--------|--------|-------|------|
| 1 | **Blink Detection Geliştirilmesi** | Basit EAR < 0.18 | Consecutive frame kontrolü + blink süresi/sayısı metriği + post-blink rejection | Tracking sırasında yanlış veri noktalarını önler |
| 2 | **I-DT Fixation Detection** | Sadece I-VT | I-VT + I-DT hybrid (düşük hız + spatial dispersion) | 30 Hz webcam'de daha kararlı fixation tespiti |
| 3 | **Saccade Detection İyileştirme** | Sadece velocity | Velocity + acceleration threshold | Daha doğru saccade onset/offset tespiti |
| 4 | **Kalibrasyon Nokta Sayısı** | 16 (4×4) | Kullanıcı seçimli: 9 (3×3), 16 (4×4), 25 (5×5) | Esneklik; daha fazla nokta = daha iyi doğruluk |

#### P1 — Yüksek (Kullanıcı Deneyimi ve Doğruluk)

| # | Boşluk | Mevcut | Hedef | Etki |
|---|--------|--------|-------|------|
| 5 | **Benchmark Framework** | Yok | Sistematik doğruluk testi: 9+ nokta, hata haritası, angular error | Nesnel performans ölçümü |
| 6 | **Gelişmiş Dataset Export** | Basit CSV | Tobii-uyumlu TSV + JSON + research metadata | Araştırma uyumluluğu |
| 7 | **AOI (Area of Interest) Analizi** | Yok | Kullanıcı tanımlı AOI + dwell time + transition matrix | Profesyonel analiz |
| 8 | **Scanpath Analysis** | Basit fixation plot | String-edit distance, scanpath similarity metrics | Araştırma kalitesi |

#### P2 — Orta (Mimari ve Performans)

| # | Boşluk | Mevcut | Hedef | Etki |
|---|--------|--------|-------|------|
| 9 | **EyeTracker.tsx refactor** | 1299 satır monolitik | Alt bileşenlere ayrılma (hooks + modüller) | Bakım kolaylığı |
| 10 | **Worker Pool** | Her seferinde yeni Worker | Reusable worker pool | Bellek ve başlatma optimizasyonu |
| 11 | **Kalibrasyon Persistence** | localStorage'a model var ama kullanılmıyor | Otomatik kaydet/yükle + session arası kalibrasyon | Kullanıcı deneyimi |

#### P3 — Düşük (İleri Özellikler)

| # | Boşluk | Mevcut | Hedef | Etki |
|---|--------|--------|-------|------|
| 12 | **Head Pose Compensation** | Yaw-aware iris weighting | Full 3D gaze decomposition (eye-in-head + head rotation) | Büyük baş hareketlerinde doğruluk |
| 13 | **Attention Map** | Heatmap | Duration-weighted attention density + temporal attention shift | İleri analiz |
| 14 | **Behavior Analysis** | Yok | Reading pattern detection, visual search analysis | Araştırma |

---

## UYGULAMA PLANI (Phase 5-9)

### İterasyon 1: Temel İyileştirmeler (P0)
1. Blink detection: consecutive frame + metrikler
2. I-DT fixation detection eklenmesi (hybrid I-VT/I-DT)
3. Saccade detection: acceleration threshold eklenmesi
4. Kalibrasyon nokta seçimi esnekliği

### İterasyon 2: Analiz ve Export (P1)
5. Benchmark framework
6. Gelişmiş dataset export
7. AOI analizi
8. Scanpath metrikleri

### İterasyon 3: Mimari ve Performans (P2)
9. EyeTracker.tsx refactoring
10. Worker pool
11. Kalibrasyon persistence

### İterasyon 4: İleri Özellikler (P3)
12. Head pose compensation
13. Attention analysis
14. Behavior analysis
