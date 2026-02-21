# Göz Takip Uygulaması – Teknik Analiz ve Eksikler Raporu

Bu belge projenin mevcut durumunu, güçlü yönlerini ve tespit edilen eksikleri özetler.

---

## 1. Proje Özeti

| Öğe | Değer |
|-----|--------|
| **Stack** | Next.js 14, React 18, TypeScript 5, Tailwind CSS 3 |
| **Ana bağımlılıklar** | MediaPipe Face Mesh, ml-regression-polynomial, ml-matrix |
| **Mimari** | App Router, client components, lib modülleri (calibration, gaze, fixation, heatmap, faceTracker) |

---

## 2. Dosya ve Modül Yapısı

```
src/
├── app/           → layout, page, error, global-error, globals.css
├── components/    → Calibration, EyeTracker, HeatmapCanvas, ImageUploader, ResultsPanel
├── contexts/      → LangContext (TR/EN)
├── lib/           → calibration, calibrationStorage, faceTracker, fixation, gazeModel, heatmap, i18n, logger
├── lib/__tests__/ → gazeModel.test.ts, fixation.test.ts
└── types/         → mediapipe.d.ts
```

**Güçlü yönler:**
- Net ayrım: UI (components), iş mantığı (lib), tip tanımları (types).
- `@/` path alias ile import tutarlılığı.
- MediaPipe için minimal tip tanımları (CDN uyumlu).

---

## 3. Tespit Edilen Eksikler ve Öneriler

### 3.1 Dokümantasyon

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **README güncel değil** | README "25 nokta kalibrasyon" yazıyor; kod 16+5 = 21 nokta kullanıyor. Ayrıca "10 fotoğraf, 60 sn/foto" akışı README’de yok. | README’yi güncelleyin: 21 nokta, 10 fotoğraf akışı, kullanım adımları. |
| **API dokümantasyonu yok** | `lib` modüllerinin public API’leri (export’lar, parametreler) dokümante değil. | JSDoc ile public fonksiyon/sınıfları açıklayın; isteğe bağlı TypeDoc. |
| **CHANGELOG / sürüm notu yok** | Sürüm geçmişi takip edilmiyor. | CHANGELOG.md ekleyin; büyük değişikliklerde sürüm notu yazın. |

---

### 3.2 Test

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **Sadece 2 unit test dosyası** | Sadece `gazeModel.test.ts` ve `fixation.test.ts` var. calibration, heatmap, faceTracker, calibrationStorage test edilmiyor. | calibration.ts (nokta üretimi, stabilite), heatmap.ts (render/export), calibrationStorage (save/load) için unit test yazın. |
| **Bileşen testi yok** | Hiçbir React bileşeni test edilmiyor. | Kritik bileşenler (ImageUploader, Calibration, ResultsPanel) için React Testing Library ile test ekleyin. |
| **E2E test yok** | Tam akış (yükleme → kalibrasyon → takip → sonuç) test edilmiyor. | Playwright veya Cypress ile en az bir smoke E2E senaryosu ekleyin. |
| **Test ortamı** | `jest.config.js` içinde `testEnvironment: "node"`; DOM kullanan modüller (heatmap canvas vb.) için uygun olmayabilir. | DOM gerektiren testler için `jsdom` kullanın (örn. ayrı jest projesi veya ortam seçimi). |
| **Coverage hedefi yok** | `collectCoverageFrom` var ama coverage eşiği veya CI’da fail yok. | `coverageThreshold` ekleyin; CI’da `npm run test -- --coverage` ile rapor üretin. |

---

### 3.3 Konfigürasyon ve Ortam

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **Tailwind content yolu** | `tailwind.config.ts` içinde `./src/pages/**/*` var; proje `app/` kullanıyor, `pages/` yok. | `pages` yolunu kaldırın veya sadece `./src/app/**/*`, `./src/components/**/*` kullanın. |
| **next.config sade** | Sadece webpack fallback (fs, path) var. | Gerekirse güvenlik başlıkları (CSP, X-Frame-Options), image domains, bundle analizi ekleyin. |
| **.env kullanımı** | `.env.example` var ama kodda `process.env.NEXT_PUBLIC_*` kullanımı yok; logger `NODE_ENV` ile çalışıyor. | Debug/feature flag’ler için `.env.example` ve dokümantasyonu güncelleyin; kullanıyorsanız Next.js env dokümantasyonuna uyun. |

---

### 3.4 Güvenlik

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **CSP / güvenlik başlıkları** | next.config’de Content-Security-Policy veya diğer güvenlik başlıkları tanımlı değil. | Production’da CSP (script-src, worker-src vb.) ekleyin; MediaPipe CDN izinleri dahil. |
| **Kullanıcı verisi** | Video ve görüntü tarayıcıda işleniyor (iyi); kalibrasyon ve dil localStorage’da. | Gizlilik politikasında localStorage kullanımını belirtin; gerekirse kullanıcı onayı. |
| **XSS** | Görüntü URL’leri data URL; React varsayılan olarak escape eder. | `dangerouslySetInnerHTML` veya doğrudan `src` dışında kullanıcı içeriği enjekte etmeyin; data URL boyut sınırı düşünülebilir. |

---

### 3.5 Hata Yönetimi ve Dayanıklılık

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **logger kullanılmıyor** | `lib/logger.ts` tanımlı ama projede `logger.log` / `logger.warn` kullanılmıyor; doğrudan `console.log`/`console.warn` var. | Hata ve debug mesajlarında `logger` kullanın; production’da log azaltımı tek yerden yönetilsin. |
| **FaceTracker hata mesajları** | initialize ve send() hataları string içeriyor; tip güvenliği zayıf. | Hata kodları veya sabit mesaj enum’ları kullanın; kullanıcıya gösterilecek metinleri i18n’e taşıyın. |
| **Kamera / MediaPipe yükleme hatası** | EyeTracker’da try/catch var ama kısmi hata senaryoları (video play fail, model yüklenemiyor) ayrıştırılmıyor. | Hata türüne göre (izin, cihaz yok, model, ağ) farklı mesaj ve yönlendirme sunun. |
| **loading / not-found yok** | `app/loading.tsx` ve `app/not-found.tsx` yok. | Root veya sayfa bazlı loading.tsx; 404 için not-found.tsx ekleyin. |

---

### 3.6 Erişilebilirlik (a11y)

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **Layout dil** | `<html lang="tr">` sabit; kullanıcı İngilizce seçince sayfa hâlâ `lang="tr"`. | LangContext’e göre `<html lang={lang}>` veya en azından `main` içeriğinde `lang` güncelleyin. |
| **Canlı bölgeler** | Sadece “Foto X/10 · Y s kaldı” için aria-live var; kalibrasyon aşaması ve sonuç geçişleri için yok. | Önemli durum değişimlerinde aria-live (polite/assertive) kullanın. |
| **Klavye ile kalibrasyon** | Kalibrasyon tamamen görsel; klavye ile ilerleme/iptal dokümante veya desteklenmiyor olabilir. | En azından “İptal” ve “Devam” için klavye odakları ve Enter/Esc davranışını netleştirin. |
| **Görsel alternatifler** | Kamera önizlemesi ve canvas için alternatif metin/etiketler kontrol edilmeli. | `alt` ve `aria-label`’ları gözden geçirin; decoratif olanlar için `aria-hidden="true"`. |

---

### 3.7 Uluslararasılaştırma (i18n)

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **Sabit Türkçe metinler** | Birçok bileşende metin doğrudan Türkçe yazılmış (örn. “Sayfayı Yenile”, “Yükleniyor...”, “Foto X tamamlandı”). | Tüm kullanıcıya dönük metinleri `i18n.ts` (veya LangContext) üzerinden verin; TR/EN anahtarlarını tutarlı kullanın. |
| **Çoklu fotoğraf akışı** | 10 fotoğraf, 60 sn, “Analizi Başlat”, “Heatmap İndir (Foto N)” gibi metinler i18n’de yok veya kısmen. | Bu akışa özel anahtarları i18n’e ekleyin; bileşenlerde `t.xxx` kullanın. |

---

### 3.8 Tip ve API Tutarlılığı

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **GazeModel constructor** | Testte `GazeModel(0.5)`, uygulamada `GazeModel(0.6, 0.4)`; ikisi de geçerli ama dokümante değil. | JSDoc ile parametreleri (lambda, smoothingAlpha) ve varsayılan değerleri yazın. |
| **ResultPerImage** | EyeTracker’da tanımlı; ResultsPanel import ediyor. Tipi paylaşan ortak bir types dosyası yok. | `src/types/results.ts` (veya benzeri) oluşturup ResultPerImage ve ilgili tipleri oraya taşıyın; hem EyeTracker hem ResultsPanel oradan import etsin. |
| **MediaPipe tipleri** | `mediapipe.d.ts` minimal; FaceMesh API değişirse kırılma riski. | Gerekirse @mediapipe/face_mesh paketinden gelen tipleri kullanın veya d.ts’i resmi API ile senkron tutun. |

---

### 3.9 Performans

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **Büyük görsel boyutu** | 10 fotoğraf data URL olarak tutuluyor; çok büyük seçimlerde bellek ve render maliyeti artar. | Dosya boyutu uyarısı veya sınır (örn. toplam MB); mümkünse resize/compress (client-side) düşünün. |
| **Heatmap render** | HeatmapCanvas her gaze/fixation değişiminde yeniden render; çok noktada yavaşlama olabilir. | Gerekirse throttle/debounce veya Web Worker ile yoğunluk hesapları; büyük canvas’larda düşük çözünürlük seçeneği. |
| **Preload** | 10 görsel preload ediliyor ama hata/iptal yönetimi yok. | Preload sırasında hata olursa tek görsel atlanabilir veya kullanıcıya bilgi verilebilir. |

---

### 3.10 CI/CD ve Kalite

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **CI pipeline yok** | GitHub Actions / GitLab CI vb. yok; lint ve test otomatik çalışmıyor. | Lint + typecheck + unit test çalıştıran bir workflow ekleyin. |
| **Lint kuralları** | next lint var; özel kural veya strict ayarlar belirsiz. | ESLint’te TypeScript strict, gerekiyorsa jsx-a11y kurallarını açın. |
| **Pre-commit hook** | Husky/lint-staged yok. | İsteğe bağlı: commit öncesi lint + test (veya sadece lint). |

---

### 3.11 Kullanıcı Deneyimi ve Edge Case’ler

| Eksik | Açıklama | Öneri |
|-------|----------|--------|
| **Takip sırasında sekme değişimi** | Kullanıcı sekmeden çıkınca kamera/takip davranışı (pause/resume) belirsiz. | Page Visibility API ile sekme görünmez olunca takibi duraklatıp, geri gelince bilgi verin veya devam ettirin. |
| **Çoklu fotoğrafta erken çıkış** | 10 fotoğraf bitmeden “Yeni Görüntü” veya tarayıcı kapatma; kısmi sonuçlar kaybolur. | “Çıkmak istediğinize emin misiniz? Şu ana kadar X fotoğraf kaydedildi.” gibi onay veya kısmi sonuç export’u. |
| **Kalibrasyon iptali** | Kalibrasyon iptal edilince ana sayfaya dönüş var; 10 fotoğraf state’i sıfırlanıyor mu net değil. | onReset ile imageUrls state’inin temizlendiğini doğrulayın; gerekirse “Yeni deneme” akışını netleştirin. |

---

## 4. Özet Tablo

| Kategori | Durum | Öncelik |
|----------|--------|---------|
| Dokümantasyon | README güncel değil, API/CHANGELOG yok | Orta |
| Test | Sadece 2 unit test; bileşen/E2E yok | Yüksek |
| Konfigürasyon | Tailwind pages yolu, next.config minimal | Düşük |
| Güvenlik | CSP ve güvenlik başlıkları yok | Orta |
| Hata yönetimi | logger kullanılmıyor, loading/not-found yok | Orta |
| Erişilebilirlik | html lang sabit, bazı metinler eksik | Orta |
| i18n | Birçok metin sabit Türkçe | Orta |
| Tipler | Ortak types, JSDoc eksik | Düşük |
| Performans | Büyük görsel/heatmap sınırı yok | Düşük |
| CI/CD | Pipeline yok | Orta |
| UX edge case’ler | Sekme/çıkış/kısmi sonuç | Düşük |

---

## 5. Önerilen Sıra (Kısa Vadede)

1. **README ve dokümantasyon**: 21 nokta, 10 fotoğraf akışı, kurulum ve kullanımı güncelleyin.
2. **Test**: calibration ve heatmap için unit test; ImageUploader veya ResultsPanel için en az bir bileşen testi.
3. **logger kullanımı**: console.log/warn yerine logger; production’da log azaltımı.
4. **i18n**: Sabit Türkçe metinleri çeviri anahtarlarına taşıyın.
5. **Tailwind content**: `src/pages` yolunu kaldırın veya sadece kullanılan dizinleri bırakın.
6. **loading.tsx / not-found.tsx**: Root loading ve 404 sayfası ekleyin.
7. **CI**: Lint + typecheck + test çalıştıran basit bir workflow.

Bu sıra, dokümantasyon doğruluğu, kalite (test, log) ve kullanıcı deneyimi (i18n, 404/loading) ile başlamanız için yeterli bir başlangıç sunar.
