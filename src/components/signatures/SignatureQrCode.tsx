import QRCode from 'qrcode';

interface SignatureQrCodeProps {
  value: string;
  className?: string;
  example?: boolean;
}

export function SignatureQrCode({
  value,
  className = 'h-14 w-14',
  example = false,
}: SignatureQrCodeProps) {
  let path = '';
  let size = 0;
  try {
    const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
    size = qr.modules.size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (qr.modules.get(x, y)) path += `M${x + 4} ${y + 4}h1v1h-1z`;
      }
    }
  } catch {
    return null;
  }

  return (
    <svg
      className={`${className} shrink-0 bg-white`}
      viewBox={`0 0 ${size + 8} ${size + 8}`}
      xmlns="http://www.w3.org/2000/svg"
      shapeRendering="crispEdges"
      role="img"
      aria-label={
        example
          ? 'QR de ejemplo: abre el verificador de documentos'
          : 'QR de verificación de la firma'
      }
    >
      <rect width={size + 8} height={size + 8} fill="#fff" />
      <path d={path} fill="#111827" />
    </svg>
  );
}
