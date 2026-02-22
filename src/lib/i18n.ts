export type Lang = "tr" | "en";

export const translations: Record<
  Lang,
  {
    appTitle: string;
    appSubtitle: string;
    privacyNote: string;
    uploadHint: string;
    orClick: string;
    formats: string;
    changeImage: string;
    startAnalysis: string;
    calibrationTitle: string;
    calibrationInstructions: string[];
    cancel: string;
    startCalibration: string;
    useSavedCalibration: string;
    saveCalibration: string;
    recalibrate: string;
    continue: string;
    calibrationComplete: string;
    calibrationFailed: string;
    startTracking: string;
    stopTracking: string;
    heatmap: string;
    driftCorrect: string;
    newImage: string;
    shortcuts: string;
    resultsTitle: string;
    exportJSON: string;
    exportHeatmap: string;
    noFixations: string;
    noROI: string;
    // 10 foto / genel
    upload10Subtitle: string;
    required10: string;
    photosLabel: string;
    startAnalysis10: string;
    startAnalysisCount: string;
    addMore: string;
    remove: string;
    dropHere: string;
    orDragHere: string;
    loading: string;
    filesLoadingLabel: string;
    reloadPage: string;
    tryAgain: string;
    goHome: string;
    pageNotFound: string;
    pageNotFoundDesc: string;
    photoComplete: string;
    nextPhoto: string;
    photoLabel: string;
    heatmapDownload: string;
    heatmapDownloadAll: string;
    exporting: string;
    noDataForPhoto: string;
    resultsLoading: string;
    clearStoredCalibration: string;
    selectImageFiles: string;
    errorTitle: string;
    errorDefaultMessage: string;
    backToHome: string;
    upload10Hint: string;
    selectImages: string;
    skipCropping: string;
    cropThenStart: string;
    pupilAlignTitle: string;
    pupilAlignDesc: string;
    pupilAlignHint: string;
    pupilAlignSkip: string;
    pupilAlignDone: string;
    calibrationValidationGood: string;
    calibrationValidationFair: string;
    calibrationValidationPoor: string;
    calibrationQualityLow: string;
    continueAnyway: string;
    lookHereThenClick: string;
    croppingFaces: string;
    croppingProgress: string;
    tcEntryTitle: string;
    tcEntryPlaceholder: string;
    tcEntrySubmit: string;
    tcEntryInvalid: string;
    tcEntryAlreadyUsed: string;
    tcEntryExplanation: string;
    noPhotosYet: string;
    noPhotosYetHint: string;
  }
> = {
  tr: {
    appTitle: "Göz Takip Analizi",
    appSubtitle: "Bir fotoğraf yükleyin, webcam ile bakış noktalarınızı analiz edelim. Heatmap, fixation analizi ve ROI clustering ile detaylı sonuçlar alın.",
    privacyNote: "Gizlilik: Video yalnızca tarayıcıda işlenir, sunucuya gönderilmez.",
    uploadHint: "Fotoğrafı buraya sürükleyin",
    orClick: "veya tıklayarak dosya seçin",
    formats: "PNG, JPG, WEBP desteklenir",
    changeImage: "Değiştir",
    startAnalysis: "Analize Başla →",
    calibrationTitle: "Kalibrasyon Başlıyor",
    calibrationInstructions: [
      "Başını mümkün olduğunca sabit tut.",
      "Ekranda beliren noktaya sadece gözlerinle bak.",
      "Noktalar ekranın her tarafında görünecek.",
      "Gözünü noktadan ayırırsan kalibrasyon uzayabilir.",
    ],
    cancel: "İptal",
    startCalibration: "Yeni kalibrasyon (25 nokta)",
    useSavedCalibration: "Kayıtlı kalibrasyonu kullan",
    saveCalibration: "Kalibrasyonu kaydet (sonraki sefer atla)",
    recalibrate: "Tekrar Kalibre Et",
    continue: "Devam Et",
    calibrationComplete: "Kalibrasyon Tamamlandı",
    calibrationFailed: "Kalibrasyon Başarısız",
    startTracking: "Takibi Başlat",
    stopTracking: "Takibi Durdur",
    heatmap: "Heatmap",
    driftCorrect: "Drift Düzelt",
    newImage: "Yeni Görüntü",
    shortcuts: "Space: başlat/durdur · H: heatmap",
    resultsTitle: "Analiz Sonuçları",
    exportJSON: "JSON Dışa Aktar",
    exportHeatmap: "Heatmap PNG İndir",
    noFixations: "Henüz fixation yok.",
    noROI: "Fixation olmadığı için ROI hesaplanamadı.",
    upload10Subtitle: "1–10 fotoğraf yükleyin. Her fotoğraf 20 saniye gösterilecek ve her biri için ayrı bakış (ısı) haritası oluşturulacak.",
    required10: "En az 1, en fazla 10 görsel (her biri 20 sn gösterilecek)",
    photosLabel: "Fotoğraflar:",
    startAnalysis10: "Analizi Başlat",
    startAnalysisCount: "({n} foto · 20 sn/foto)",
    addMore: "Daha fazla ekle",
    remove: "Kaldır",
    dropHere: "Bırakın...",
    orDragHere: "veya bu alana sürükleyip bırakın",
    loading: "Yükleniyor...",
    filesLoadingLabel: "dosya yükleniyor",
    reloadPage: "Sayfayı Yenile",
    tryAgain: "Tekrar Dene",
    goHome: "Ana Sayfaya Dön",
    pageNotFound: "Sayfa bulunamadı",
    pageNotFoundDesc: "Aradığınız sayfa mevcut değil veya taşınmış olabilir.",
    photoComplete: "Foto {n}/{total} tamamlandı",
    nextPhoto: "Sonraki fotoğrafa geçiliyor...",
    photoLabel: "Foto",
    heatmapDownload: "Heatmap İndir (Foto {n})",
    heatmapDownloadAll: "Tüm {n} Heatmap İndir",
    exporting: "İndiriliyor...",
    noDataForPhoto: "Bu fotoğraf için fixation verisi yok.",
    resultsLoading: "Sonuç verisi yükleniyor...",
    clearStoredCalibration: "Kayıtlı kalibrasyonu sil",
    selectImageFiles: "Lütfen görüntü dosyası seçin (PNG, JPG, WEBP).",
    errorTitle: "Bir hata oluştu",
    errorDefaultMessage: "Beklenmeyen bir sorun oluştu. Sayfayı yenilemeyi deneyin.",
    backToHome: "Ana sayfaya dön",
    upload10Hint: "1–10 fotoğrafı sürükleyin veya tıklayıp seçin",
    selectImages: "Fotoğraf seç",
    skipCropping: "Kırpmadan başlat",
    cropThenStart: "Yüze göre kırp ve başlat",
    pupilAlignTitle: "İsteğe bağlı: Göz bebeği hizalama",
    pupilAlignDesc: "Yeşil ve mavi noktalar göz bebeklerinizin tespit edilen konumunu gösterir. Yanlışsa sürükleyerek düzeltebilirsiniz; doğruysa \"Hizaladım\" deyin.",
    pupilAlignHint: "Sol göz = yeşil, sağ göz = mavi. Sürükleyerek konumu düzeltin.",
    pupilAlignSkip: "Atla",
    pupilAlignDone: "Hizaladım",
    calibrationValidationGood: "Doğrulama başarılı — takip kullanıma hazır.",
    calibrationValidationFair: "Doğrulama orta seviye. İsterseniz tekrar kalibre edebilirsiniz.",
    calibrationValidationPoor: "Doğruluk düşük. Daha iyi sonuç için tekrar kalibrasyon önerilir.",
    calibrationQualityLow: "Kalibrasyon kalitesi düşük. Takibin doğru çalışması için tekrar kalibre edin.",
    continueAnyway: "Yine de devam et",
    lookHereThenClick: "Önce bu noktaya bak, sonra tıkla",
    croppingFaces: "Yüzler algılanıyor, ölü alanlar kırpılıyor...",
    croppingProgress: "Foto {n} / {total}",
    tcEntryTitle: "Giriş",
    tcEntryPlaceholder: "TC Kimlik No (11 rakam)",
    tcEntrySubmit: "Devam",
    tcEntryInvalid: "Geçerli bir TC Kimlik No girin.",
    tcEntryAlreadyUsed: "Bu TC Kimlik No ile daha önce işlem yapıldı. Her kişi yalnızca bir kez bakabilir.",
    tcEntryExplanation: "Farklı kişiler kullanacağı için TC Kimlik No ile giriş yapılmaktadır. Her TC yalnızca bir kez kullanılabilir.",
    noPhotosYet: "Fotoğraflar henüz yüklenmedi.",
    noPhotosYetHint: "Devam etmek için fotoğraf yükleyin.",
  },
  en: {
    appTitle: "Eye Tracking Analysis",
    appSubtitle: "Upload an image and analyze gaze points with your webcam. Get detailed results with heatmap, fixation analysis, and ROI clustering.",
    privacyNote: "Privacy: Video is processed only in the browser; it is not sent to any server.",
    uploadHint: "Drag your photo here",
    orClick: "or click to select a file",
    formats: "PNG, JPG, WEBP supported",
    changeImage: "Change",
    startAnalysis: "Start Analysis →",
    calibrationTitle: "Calibration Starting",
    calibrationInstructions: [
      "Keep your head as still as possible.",
      "Look at the dot on screen with your eyes only.",
      "Dots will appear across the screen.",
      "If you look away, calibration may take longer.",
    ],
    cancel: "Cancel",
    startCalibration: "New calibration (25 points)",
    useSavedCalibration: "Use saved calibration",
    saveCalibration: "Save calibration (skip next time)",
    recalibrate: "Recalibrate",
    continue: "Continue",
    calibrationComplete: "Calibration Complete",
    calibrationFailed: "Calibration Failed",
    startTracking: "Start Tracking",
    stopTracking: "Stop Tracking",
    heatmap: "Heatmap",
    driftCorrect: "Drift Correct",
    newImage: "New Image",
    shortcuts: "Space: start/stop · H: heatmap",
    resultsTitle: "Analysis Results",
    exportJSON: "Export JSON",
    exportHeatmap: "Download Heatmap PNG",
    noFixations: "No fixations yet.",
    noROI: "ROI could not be computed (no fixations).",
    upload10Subtitle: "Upload 1–10 photos. Each will be shown for 20 seconds and a separate gaze heatmap will be generated for each.",
    required10: "Between 1 and 10 images (each shown 20s)",
    photosLabel: "Photos:",
    startAnalysis10: "Start analysis",
    startAnalysisCount: "({n} photos · 20s each)",
    addMore: "Add more",
    remove: "Remove",
    dropHere: "Drop here...",
    orDragHere: "or drag and drop here",
    loading: "Loading...",
    filesLoadingLabel: "files loading",
    reloadPage: "Reload page",
    tryAgain: "Try again",
    goHome: "Back to home",
    pageNotFound: "Page not found",
    pageNotFoundDesc: "The page you are looking for does not exist or has been moved.",
    photoComplete: "Photo {n}/{total} complete",
    nextPhoto: "Loading next photo...",
    photoLabel: "Photo",
    heatmapDownload: "Download heatmap (Photo {n})",
    heatmapDownloadAll: "Download all {n} heatmaps",
    exporting: "Downloading...",
    noDataForPhoto: "No fixation data for this photo.",
    resultsLoading: "Loading results...",
    clearStoredCalibration: "Clear stored calibration",
    selectImageFiles: "Please select image files (PNG, JPG, WEBP).",
    errorTitle: "An error occurred",
    errorDefaultMessage: "An unexpected error occurred. Try reloading the page.",
    backToHome: "Back to home",
    upload10Hint: "Drag 1–10 photos or click to select",
    selectImages: "Select photos",
    skipCropping: "Start without cropping",
    cropThenStart: "Crop to face then start",
    pupilAlignTitle: "Optional: Pupil alignment",
    pupilAlignDesc: "Green and blue dots show the detected pupil positions. Drag to correct if wrong, or click \"I'm done\" if they look correct.",
    pupilAlignHint: "Left eye = green, right eye = blue. Drag to adjust position.",
    pupilAlignSkip: "Skip",
    pupilAlignDone: "I'm done",
    calibrationValidationGood: "Validation passed — tracking ready to use.",
    calibrationValidationFair: "Validation moderate. You may recalibrate for better accuracy.",
    calibrationValidationPoor: "Accuracy is low. Recalibration recommended for better results.",
    calibrationQualityLow: "Calibration quality is low. Recalibrate for accurate tracking.",
    continueAnyway: "Continue anyway",
    lookHereThenClick: "Look at this point, then click",
    croppingFaces: "Detecting faces, cropping empty space...",
    croppingProgress: "Photo {n} / {total}",
    tcEntryTitle: "Entry",
    tcEntryPlaceholder: "ID Number (11 digits)",
    tcEntrySubmit: "Continue",
    tcEntryInvalid: "Please enter a valid ID number.",
    tcEntryAlreadyUsed: "This ID has already been used. Each person can only view once.",
    tcEntryExplanation: "Entry is done with ID number because different people will use it. Each ID can only be used once.",
    noPhotosYet: "No photos have been uploaded yet.",
    noPhotosYetHint: "Upload photos to continue.",
  },
};

const LANG_KEY = "eye-tracking-lang";

export function getStoredLang(): Lang {
  if (typeof window === "undefined") return "tr";
  try {
    const s = localStorage.getItem(LANG_KEY);
    return s === "en" ? "en" : "tr";
  } catch {
    return "tr";
  }
}

export function setStoredLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // ignore
  }
}
