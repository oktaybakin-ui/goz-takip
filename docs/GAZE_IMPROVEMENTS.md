# Göz Takibi İyileştirmeleri – İnternet Araştırması ve Uygulama

Bu belge, kaliteli açık kaynak projelerden öğrenilenleri ve projeye eklenen **manuel göz bebeği hizalama** adımını özetler.

---

## Taranan projeler ve öğrenilenler

### 1. **WebGazer.js** (Brown University)
- **Özellik:** Tıklama ve imleç hareketiyle kendini kalibre eden web tabanlı göz takibi.
- **Öğrenilen:** 9 noktalı açık kalibrasyon örneği (`calibration.html`), Kalman filtresi, doğruluk ölçümü. Kalibrasyon noktaları ve kullanıcı geri bildirimi doğruluğu artırıyor.

### 2. **MediaPipe Iris & araştırma**
- **Özellik:** Tek RGB kamera ile iris takibi; kişiselleştirilmiş kalibrasyon.
- **Öğrenilen:** “Few-shot personalization”: sadece **3 kalibrasyon noktası** bile kalibrasyonsuz modele göre ~%24 doğruluk artışı sağlıyor. Kişiye özel kalibrasyon, eğitimde görülmeyen kullanıcılar için önemli.

### 3. **Pupil Labs (Manual Mapper / Mapping Correction)**
- **Özellik:** Otomatik işleme sonrası kullanıcı, referans görüntüde tıklayarak fixation konumunu düzeltebiliyor veya eksik eşleşmeleri tamamlıyor.
- **Öğrenilen:** “Human in the loop” – kullanıcının göz bebeği / bakış konumunu doğrulaması veya düzeltmesi, otomatik tespit hatalarını azaltıyor.

### 4. **Genel kalibrasyon pratikleri**
- Ekranda işaretçi (marker) takip ederek kalibrasyon yaygın ve etkili.
- Kalibrasyon sonrası **doğrulama (validation)** ile hata ölçümü yapılmalı.
- Göz bebeği merkezi tespiti: iki aşamalı (kaba + ince) iyileştirme doğruluğu artırıyor.

---

## Bu projede uygulananlar

### İsteğe bağlı: Kalibrasyon öncesi göz bebeği hizalama

- **Amaç:** MediaPipe’ın iris merkezi bazen (ışık, gözlük, açı) kayabiliyor. Kullanıcı, kalibrasyondan **önce** bir kez bu merkezleri kontrol edip düzeltebilsin; kalibrasyon bu düzeltilmiş konuma göre yapılsın.
- **Akış:**
  1. Kamera açıldıktan sonra **“İsteğe bağlı: Göz bebeği hizalama”** ekranı gelir.
  2. Canlı videoda **yeşil** (sol göz) ve **mavi** (sağ göz) noktalar, tespit edilen iris merkezlerini gösterir.
  3. Kullanıcı noktaları **sürükleyerek** gerçek göz bebeği konumuna getirebilir.
  4. **“Atla”** → offset uygulanmaz, mevcut tespit kullanılır.
  5. **“Hizaladım”** → (kullanıcı konumu − tespit konumu) offset olarak kaydedilir; kalibrasyon ve takip bu offset ile yapılır.
- **Teknik:** `FaceTracker.setIrisOffset(left, right)` ile normalize (0–1) offset verilir; `extractFeatures` içinde iris merkezi `detected + offset` olarak kullanılır, böylece göreceli iris pozisyonu (relX, relY) düzeltilmiş merkeze göre hesaplanır.

### Neden isteğe bağlı?

- Çoğu kullanıcı için varsayılan tespit yeterli olabilir.
- Gözlük, farklı ışık veya köşe açılarında hizalama doğruluğu artırır.
- WebGazer ve Pupil Labs’taki “kullanıcı düzeltmesi” fikri, bu adımla uyumludur.

---

---

## İkinci tur entegrasyonlar (benzer projelerden)

### 1. Doğrulama bias’ı: merkez ağırlıklı ortalama
- **Kaynak:** Gaze validation çalışmaları (merkez görme alanı daha güvenilir).
- **Uygulama:** Doğrulama örneklerinden sapma (bias) ortalaması alınırken, ekran merkezine yakın noktalar daha yüksek ağırlık alır: `w = 1 / (1 + distance_from_center)`. Böylece köşe hataları drift düzeltmesini daha az bozar.

### 2. Tahmin çıktısında kısa median filtre
- **Kaynak:** “Cost function to determine optimum filter for stabilising gaze data” (PMC7881889); pencere tabanlı jitter azaltma.
- **Uygulama:** One Euro Filter çıktısından sonra son 5 tahminin x/y medyanı alınır; ani sıçramalar yumuşar, gecikme sınırlı kalır.

### 3. Kalibrasyonda yüksek residual atıp yeniden eğitme
- **Kaynak:** “Testing multiple polynomial models for eye-tracker calibration”; Ridge + outlier-tolerant fitting ile ~%20’ye varan hata azalması.
- **Uygulama:** İlk Ridge eğitiminden sonra her örneğin residual’ı hesaplanır, en yüksek %10 atılır (en az 55 örnek kalacak şekilde), kalan örneklerle model bir kez daha eğitilir.

### 4. Doğrulama sonrası net kullanıcı geri bildirimi
- **Kaynak:** RealEye / Pupil Labs: doğrulama sonucunun kullanıcıya açık iletilmesi.
- **Uygulama:** Kalibrasyon tamamlandı ekranında 3 kademe: ≤50 px “Doğrulama başarılı”, ≤85 px “Orta seviye”, >85 px “Tekrar kalibrasyon önerilir”. i18n ile TR/EN mesajlar.

---

## Kısa referans

| Kaynak              | Öğrenilen / Uygulama                          |
|---------------------|-----------------------------------------------|
| WebGazer.js         | Açık kalibrasyon noktaları, doğruluk ölçümü   |
| MediaPipe / araştırma | Kişiye özel kalibrasyon, az nokta ile iyileşme |
| Pupil Labs          | Manuel düzeltme (human in the loop)           |
| RealEye / PMC       | Nokta sayısı, doğrulama, filtre parametreleri |
| Polynomial calibration (Springer) | Ridge + outlier-tolerant, residual ile yeniden eğit |
| Bu proje            | Göz bebeği hizalama, merkez-ağırlıklı bias, median filtre, residual retrain, 3 kademeli doğrulama mesajı |
