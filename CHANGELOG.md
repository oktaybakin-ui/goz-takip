# Changelog

Tüm önemli değişiklikler bu dosyada listelenir.

## [Unreleased]

### Eklenen
- Kalibrasyonu kaydetme / yükleme (localStorage) – "Kalibrasyonu kaydet" ve "Kayıtlı kalibrasyonu kullan"
- JSON dışa aktarmada ham gaze noktaları (`gaze_points`, `gaze_point_count`)
- Geliştirme logları için `src/lib/logger.ts` (production'da sessiz)
- `.env.example` örnek ortam değişkenleri
- Gizlilik notu: "Video yalnızca tarayıcıda işlenir, sunucuya gönderilmez"
- MediaPipe / kamera hata mesajları iyileştirildi
- Klavye kısayolları: Space (takip başlat/durdur), H (heatmap)
- Erişilebilirlik: ana butonlarda aria-label
- Takip sırasında setState throttle (performans)
- Scanpath: fixation sırası okları (ResultsPanel)
- Basit çoklu dil (TR/EN) – dil seçici
- Jest + temel unit testler (gazeModel, fixation)
- MediaPipe için minimal TypeScript tipleri
- CHANGELOG.md

### Değişen
- Kalibrasyon 16+5 nokta (önceden 25+9)
- Doğrulama bias'ı takip başında uygulanıyor

---

## [0.1.0] – İlk sürüm

- 16 noktalı kalibrasyon, 5 nokta doğrulama
- Polinom Ridge gaze modeli, doğrulama bias düzeltmesi
- Fixation (I-VT), ROI (DBSCAN), heatmap, JSON/PNG export
- MediaPipe Face Mesh + İris, One Euro Filter
