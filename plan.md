# Kalibrasyon Kalitesi İyileştirme Planı

## Sorun Analizi
Mevcut sistem 25 nokta + 30 örnek/nokta ile kalibrasyon yapıyor. Stabilite eşikleri gevşek, countdown kısa, ve kenar noktalar merkeze göre daha az doğru.

## Değişiklikler

### 1. calibration.ts — Stabilite & Veri Toplama
- **Countdown**: 2s → 3s (kullanıcı noktayı bulup odaklanmaya daha fazla zaman)
- **Samples per point**: 30 → 45 (daha fazla veri = daha iyi regresyon)
- **Iris stabilite**: IRIS_STD_MAX 0.04 → 0.025 (sadece gerçekten sabit bakışta örnek al)
- **Minimum confidence**: 0.35 → 0.45 (daha yüksek güvenli örnekler)
- **Head movement threshold**: 0.14 → 0.10 (baş hareketi toleransı sıkılaştır)
- **Eye openness**: 0.06 → 0.12 (yarı kapalı göz verisi alma)
- **Retry threshold**: 15 → 25 (düşük kaliteli noktaları daha agresif tekrar et)
- **Kenar noktalar için ek örneklem**: Köşe/kenar noktalarında 50% daha fazla örnek

### 2. Calibration.tsx — UI/UX
- Countdown 2 → 3 saniye
- Doğrulama samples 35 → 50

### 3. gazeModel.ts — Model Eğitimi
- Lambda aday listesini genişlet: [0.0005, 0.001, 0.002, 0.004, 0.008, 0.015, 0.02, 0.05, 0.1]
- Residual dropout: %10 → %12 (daha agresif outlier temizliği)
- Minimum geçerli örnek: 62 → 80

## Dosyalar
- `src/lib/calibration.ts`
- `src/components/Calibration.tsx`
- `src/lib/gazeModel.ts`
