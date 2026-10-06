import { useMemo } from "react";
import QRCode from "qrcode";

/**
 * QR dibujado desde la matriz de módulos como `<path>` de SVG: no se inyecta HTML. Es un código generado por la aplicación
 * (SPECS 10.3) y contiene solo el enlace público con el código de sala, nunca una credencial.
 */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const { path, count } = useMemo(() => {
    const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
    const n = qr.modules.size;
    let d = "";
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
    return { path: d, count: n };
  }, [value]);
  const quiet = 2;
  return (
    <svg className="qr" width={size} height={size} viewBox={`${-quiet} ${-quiet} ${count + quiet * 2} ${count + quiet * 2}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-quiet} y={-quiet} width={count + quiet * 2} height={count + quiet * 2} fill="#fff" />
      <path d={path} fill="#2b1f14" />
    </svg>
  );
}
