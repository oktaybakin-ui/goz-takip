/**
 * Web Worker oluşturma yardımcı modülü.
 * Inline blob worker'lar oluşturarak harici dosya gerekmeden çalışır.
 * CSP: worker-src 'self' blob: ile uyumlu.
 */

type WorkerFn = (...args: any[]) => void;

/**
 * Bir fonksiyonu inline Web Worker olarak çalıştırır.
 * @param fn - Worker olarak çalıştırılacak fonksiyon (self-contained olmalı)
 * @returns Worker instance veya null (desteklenmiyorsa)
 */
export function createInlineWorker(fn: WorkerFn): Worker | null {
  if (typeof Worker === "undefined") return null;

  try {
    const blob = new Blob([`(${fn.toString()})()`], {
      type: "application/javascript",
    });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    // Blob URL'i worker yüklendikten sonra temizle
    const cleanup = () => URL.revokeObjectURL(url);
    worker.addEventListener("error", cleanup, { once: true });
    // Worker başarıyla başlatıldıysa, ilk mesajdan sonra cleanup
    const origOnMessage = worker.onmessage;
    let cleaned = false;
    worker.addEventListener(
      "message",
      () => {
        if (!cleaned) {
          cleanup();
          cleaned = true;
        }
      },
      { once: true }
    );

    return worker;
  } catch {
    return null;
  }
}

/**
 * Promise tabanlı Worker mesaj gönderimi.
 * Worker'a mesaj gönderir, cevap bekler, timeout uygular.
 */
export function postWorkerMessage<TInput, TOutput>(
  worker: Worker,
  message: TInput,
  transfer?: Transferable[],
  timeoutMs: number = 10000
): Promise<TOutput> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Worker timeout"));
    }, timeoutMs);

    const handler = (e: MessageEvent<TOutput>) => {
      clearTimeout(timer);
      worker.removeEventListener("message", handler);
      resolve(e.data);
    };

    worker.addEventListener("message", handler);

    if (transfer?.length) {
      worker.postMessage(message, transfer);
    } else {
      worker.postMessage(message);
    }
  });
}
