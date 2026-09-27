"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { extractRoomCode } from "@/lib/room-code";

export function QrRoomScanner({
  open,
  onClose,
  onRoom,
}: {
  open: boolean;
  onClose: () => void;
  onRoom: (code: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const lastScanRef = useRef(0);
  const resolvedRef = useRef(false);
  const [status, setStatus] = useState("Запрашиваем доступ к камере…");
  const [error, setError] = useState<string | null>(null);

  function stopCamera() {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function acceptDecodedValue(value: string): boolean {
    const code = extractRoomCode(value, window.location.origin);
    if (!code) {
      setError("Это не QR комнаты МЕМ-БАТЛ. Отсканируйте код из лобби игры.");
      return false;
    }
    if (resolvedRef.current) return true;
    resolvedRef.current = true;
    setError(null);
    setStatus(`Комната ${code} найдена — открываем…`);
    stopCamera();
    window.setTimeout(() => onRoom(code), 250);
    return true;
  }

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }

    resolvedRef.current = false;
    setError(null);
    setStatus("Запрашиваем доступ к камере…");
    let disposed = false;

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Этот браузер не умеет открывать камеру. Загрузите фото QR-кода из галереи.");
        setStatus("Камера недоступна");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (disposed) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus("Наведите камеру на QR-код комнаты");

        const scan = (now: number) => {
          if (disposed || resolvedRef.current) return;
          frameRef.current = requestAnimationFrame(scan);
          // 6 кадров в секунду хватает для QR и не перегружает телефон.
          if (now - lastScanRef.current < 165) return;
          lastScanRef.current = now;
          if (video.readyState < HTMLMediaElement.HAVE_ENOUGH_DATA) return;

          const canvas = canvasRef.current;
          if (!canvas || video.videoWidth === 0 || video.videoHeight === 0) return;
          const maxWidth = 720;
          const scale = Math.min(1, maxWidth / video.videoWidth);
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(image.data, image.width, image.height, {
            inversionAttempts: "attemptBoth",
          });
          if (result?.data) acceptDecodedValue(result.data);
        };

        frameRef.current = requestAnimationFrame(scan);
      } catch (cause) {
        const denied = cause instanceof DOMException && cause.name === "NotAllowedError";
        setError(
          denied
            ? "Доступ к камере запрещён. Разрешите камеру в настройках браузера или загрузите фото QR-кода."
            : "Не удалось открыть камеру. Попробуйте загрузить фото QR-кода.",
        );
        setStatus("Камера не запущена");
      }
    }

    void startCamera();
    return () => {
      disposed = true;
      stopCamera();
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function scanFile(file: File) {
    setError(null);
    setStatus("Читаем QR-код на изображении…");
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = objectUrl;
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("image-load-failed"));
      });
      const canvas = canvasRef.current ?? document.createElement("canvas");
      const maxSide = 1400;
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("canvas-not-available");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(pixels.data, pixels.width, pixels.height, {
        inversionAttempts: "attemptBoth",
      });
      if (!result?.data) {
        setError("QR-код на изображении не найден. Выберите более чёткое фото.");
        setStatus("Не удалось распознать QR");
        return;
      }
      acceptDecodedValue(result.data);
    } catch {
      setError("Не удалось прочитать изображение. Попробуйте другое фото.");
      setStatus("Ошибка изображения");
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Сканер QR-кода комнаты">
      <div className="glass w-full max-w-lg overflow-hidden rounded-[28px] shadow-[0_30px_100px_rgba(0,0,0,.8)]">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-lg font-black">Сканировать QR комнаты</div>
            <div className="mt-0.5 text-xs text-violet-300/60">Код откроется автоматически</div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/5 text-lg text-violet-100 transition hover:border-hot hover:bg-hot/15"
            aria-label="Закрыть сканер"
          >
            ×
          </button>
        </div>

        <div className="relative aspect-[4/3] overflow-hidden bg-black">
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
          <canvas ref={canvasRef} className="hidden" aria-hidden />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,transparent_0,transparent_31%,rgba(0,0,0,.48)_32%)]">
            <div className="relative h-[56%] w-[56%] max-w-[250px] rounded-3xl border border-white/35">
              <i className="absolute -left-0.5 -top-0.5 h-10 w-10 rounded-tl-3xl border-l-4 border-t-4 border-aqua" />
              <i className="absolute -right-0.5 -top-0.5 h-10 w-10 rounded-tr-3xl border-r-4 border-t-4 border-aqua" />
              <i className="absolute -bottom-0.5 -left-0.5 h-10 w-10 rounded-bl-3xl border-b-4 border-l-4 border-aqua" />
              <i className="absolute -bottom-0.5 -right-0.5 h-10 w-10 rounded-br-3xl border-b-4 border-r-4 border-aqua" />
              <span className="absolute left-4 right-4 top-1/2 h-px animate-pulse bg-aqua shadow-[0_0_12px_#22d3ee]" />
            </div>
          </div>
        </div>

        <div className="p-5 text-center">
          <p className="text-sm font-bold text-violet-100">{status}</p>
          {error && (
            <p className="mt-2 rounded-xl border border-hot/35 bg-hot/10 px-3 py-2 text-xs leading-relaxed text-pink-200">
              {error}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void scanFile(file);
            }}
          />
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-violet-100 transition hover:border-aqua hover:text-aqua"
            >
              🖼 Загрузить QR из галереи
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-3 text-xs font-bold uppercase tracking-wider text-violet-300 transition hover:text-white"
            >
              Ввести код вручную
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
