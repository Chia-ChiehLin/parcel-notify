'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

/** 用平板／手機相機掃條碼或 QR code。USB／藍牙掃描槍則直接打字到輸入框即可，不需要這個元件。 */
export function CameraScanner({ onResult, onClose, title = '掃描' }: { onResult: (text: string) => void; onClose: () => void; title?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // 父元件每次重繪都會傳新的函式，用 ref 保存避免相機重新啟動
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
          if (result && !stopped) {
            stopped = true;
            controls?.stop();
            if (navigator.vibrate) navigator.vibrate(80);
            onResultRef.current(result.getText());
          }
        });
        if (stopped) controls.stop();
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setError(name === 'NotAllowedError' ? '沒有相機權限，請在瀏覽器設定允許使用相機' : '無法開啟相機');
      }
    })();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4">
      <div className="mb-3 flex items-center justify-between text-white">
        <span className="text-lg font-semibold">{title}</span>
        <Button variant="secondary" onClick={onClose}>
          關閉
        </Button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl bg-black">
        {error ? <p className="px-6 text-center text-white">{error}</p> : <video ref={videoRef} className="h-full w-full object-contain" muted playsInline />}
        {!error ? <div className="pointer-events-none absolute inset-x-[15%] top-1/2 h-40 -translate-y-1/2 rounded-xl border-4 border-white/70" /> : null}
      </div>
      <p className="mt-3 text-center text-sm text-white/70">把條碼或 QR code 對準框框</p>
    </div>
  );
}

/** 把相機拍的照片縮小、轉成 JPEG（約 100–250KB），減少上傳時間和儲存空間 */
export async function compressImage(file: File, maxSide = 1280, quality = 0.75): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}
