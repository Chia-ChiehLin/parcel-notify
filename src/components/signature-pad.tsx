'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

/** 手寫簽名板，輸出 PNG data URL */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-gray-300 bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = e.currentTarget.getContext('2d')!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d')!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          if (!hasInk.current) {
            hasInk.current = true;
            setEmpty(false);
          }
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (hasInk.current) onChange(e.currentTarget.toDataURL('image/png'));
        }}
      />
      <div className="mt-2 flex items-center justify-between text-sm text-gray-500">
        <span>{empty ? '請領取人在框內簽名' : '已簽名'}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const c = canvasRef.current!;
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
            hasInk.current = false;
            setEmpty(true);
            onChange(null);
          }}
        >
          清除
        </Button>
      </div>
    </div>
  );
}
