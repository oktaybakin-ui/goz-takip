# Göz Takibi Doğruluk Analizi – Neden İyi Değil?

Bu belge projeyi inceleyerek göz takibinin neden düşük doğrulukla çalıştığını teknik olarak açıklar.

---

## 1. Genel Akış (Özet)

```
Kamera (MediaPipe Face Mesh + Iris)
    → EyeFeatures (iris relX/relY, yaw, pitch, roll, scale, confidence)
    → GazeModel (2. derece polinom + Ridge regresyon)
    → Ekran koordinatı (viewport x,y)
    → userOffset ("Burada bakıyorum") + content rect clamp
    → screenToImageCoords
    → Görüntü koordinatı (gaze_point x,y)
```

---

## 2. Temel Kısıtlar (Donanım ve Yöntem)

### 2.1 Tek Webcam ile Görünüşe Dayalı Gaze

- **Tek RGB kamera** kullanılıyor; derinlik veya stereo bilgi yok.
- Araştırmalara göre benzer sistemlerde tipik doğruluk **~3–6°**.
- 60 cm mesafede 1° ≈ ekranda **~1 cm** (Full HD’de yaklaşık 20–25 px).
- Yani **~100 px civarı hata** bu yöntem için olağan bir aralıktadır.

### 2.2 MediaPipe Iris Sınırları

- **2D landmark** (x, y); iris derinliği veya pupilla boyutu doğrudan modellenmiyor.
- Gözlük, ışık, kısmi kapatma durumunda landmark’lar **gürültülü** veya **kayabilir**.
- `refineLandmarks: true` kullanılsa da tek karede tespit hatası kaçınılmazdır.

---

## 3. Model ve Kalibrasyon

### 3.1 Polinom Regresyon Kapasitesi

| Parametre | Değer |
|-----------|--------|
| Girdi özellikleri | 10 (avgRelX/Y, leftRelX/Y, rightRelX/Y, yaw, pitch, roll, faceScale) |
| Polinom derecesi | 2 |
| Toplam terim sayısı | 66 (1 + 10 + 55) |

- Görünüş → ekran haritası oldukça **non-lineer**.
- İkinci derece polinom:
  - Köşelerde ve kenarlarda yeterince esnek olmayabilir,
  - Yetersiz kalibrasyon verisinde hem underfit hem overfit riski taşır.

### 3.2 Kalibrasyon Grid

- **16 nokta** (4×4) kullanılıyor; noktalar viewport üzerinde karıştırılıyor.
- 5 doğrulama noktası (merkez + 4 köşe).
- Köşe ve kenar bölgelerinde veri az olduğu için **ekstrapolasyon** hatalı olabilir.

### 3.3 Örnek Toplama

| Parametre | Değer |
|-----------|--------|
| Nokta başına hedef örnek | 62 |
| Settle frame | 22 (~700 ms) |
| Gerçek örnek / nokta | ~40 |
| Minimum confidence | 0.28 |
| Baş hareket eşiği | 0.065 |

- Settle süresi göz hareketinin tam sönmesi için yeterli olmayabilir.
- Baş hareket eşiği bazı kullanıcılar için fazla sıkı olabilir; daha az geçerli örnek toplanır.
- **Outlier atma:** En yüksek residual’a sahip %10 örnek atılıyor; bazen iyi örnekler de gidebilir.

---

## 4. Koordinat ve Görüntü Sistemi

### 4.1 Kalibrasyon vs. Takip

- **Kalibrasyon:** Hedefler tam viewport (`window.innerWidth` × `window.innerHeight`) üzerinde.
- **Takip:** Model viewport (x, y) üretiyor; sonra `getImageRect()` ile **görüntü container**’a göre `screenToImageCoords` ile dönüştürülüyor.
- Görüntü `object-contain` ile letterbox/pillarbox olunca **content rect** hesabı kritik; yanlış hesaplama hata kaynağı olur.

### 4.2 Ayna / Kamera Yönü

- Ön kamera kullanılıyor; görüntü genelde **ayna gibi** (sağ/sol ters).
- `flipGazeX` / `flipGazeY` manuel düzeltme için var; varsayılan ayar her cihaz için doğru olmayabilir.
- MediaPipe, ham video koordinatlarına göre çalışır; CSS mirror sadece görüntüyü etkiler, modelin gördüğü frame’i değiştirmez.

### 4.3 "Burada bakıyorum" Offset

- Offset **ekran pikseli** cinsinden; `(targetX - raw.x, targetY - raw.y)`.
- Hedef: content rect merkezi (son düzeltme ile).
- Problem: Tek tıklamada **o anda** model çok kötü tahmin üretiyorsa, offset yanlış sabitlenir ve tüm takip boyunca uygulanır.
- Birden fazla tıklama için medyan/ortalama kullanılmıyor; sadece son tıklama geçerli.

---

## 5. Sonuçlardaki Görülen Hatalar

Export edilen JSON’da:

- Çoğu gaze noktası **y = 589** (alt kenar) veya **(589, 589)** (sağ alt köşe).
- Kalibrasyon hatası: ~111–221 px.
- `user_offset_applied` değerleri büyük (örn. x: -11986, y: 1620).

**Yorum:** Model tahminleri sık sık **görüntü dışında**; content rect içine kısıtlama (clamp/blend) yüzünden noktalar kenarlarda birikiyor. Offset’in büyüklüğü, ham tahminlerin viewport’tan ciddi biçimde sapmış olduğunu gösteriyor.

---

## 6. Olası Hata Kaynakları (Özet)

| # | Kaynak | Açıklama |
|---|--------|----------|
| 1 | Tek webcam sınırı | Görünüşe dayalı yöntem; tipik 3–6° hata, ≈100 px civarı beklenir |
| 2 | MediaPipe gürültüsü | Iris landmark’larda jitter, gözlük/ışık etkisi |
| 3 | Polinom modeli | 2. derece; köşe/kenar bölgelerini iyi temsil edemeyebilir |
| 4 | Kalibrasyon kalitesi | Baş hareketi, az örnek, confidence düşüklüğü |
| 5 | Koordinat uyumsuzluğu | Content rect, letterbox, mirror ayarları |
| 6 | Tek tıklık offset | "Burada bakıyorum" tek seferde; kötü tahminle sabit yanlış offset |
| 7 | Viewport / konum değişimi | Pencere boyutu veya görüntü konumu değişirse kalibrasyon geçersizleşir |

---

## 7. Öneriler (Öncelik Sırasıyla)

1. **Kalibrasyonu sıkılaştırma**
   - Kalibrasyon hatası **75 px altında** olmadan takibe izin vermek.
   - Settle süresini 1 saniyeye çıkarmak.
   - Nokta başına örnek sayısını artırmak (ör. 60+).

2. **"Burada bakıyorum" iyileştirmesi**
   - Son 3–5 tıklamanın **medyanı** ile offset hesaplamak.
   - Offset büyüklüğünü makul bir aralıkla sınırlamak.

3. **Model ve kalibrasyon**
   - Daha fazla kalibrasyon noktası (ör. 25 veya 9 merkez + 16 kenar).
   - İsteğe bağlı: 3. derece polinom veya farklı model ailesi denemek.

4. **Kullanıcı talimatları**
   - Kalibrasyonda başın sabit tutulması.
   - İyi ve eşit ışık.
   - Gözlük varsa camlarda parlama olmaması.

5. **Sistem seviyesi iyileştirmeler**
   - Daha iyi kamera (720p+, yüksek FPS).
   - Sabit mesafe ve açı (ör. 50–70 cm).

---

## 8. Referanslar

- `src/lib/gazeModel.ts` – Polinom modeli, Ridge regresyon, One Euro Filter
- `src/lib/faceTracker.ts` – MediaPipe Face Mesh, iris centroid, landmark filtreleri
- `src/lib/calibration.ts` – 16 nokta grid, stabilite, örnek toplama
- `docs/GAZE_IMPROVEMENTS.md` – WebGazer, MediaPipe, Pupil Labs’ten alınan uygulamalar
