'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Check, RotateCcw, PenLine, Loader2, CheckCircle2, Camera, ChevronRight, AlertTriangle, Download, Shield, Smartphone, Monitor, QrCode, RefreshCw, Clock, Share2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import QRCode from 'qrcode';

// ─── SHA-256 helpers ──────────────────────────────────────────────────────────
async function sha256(str: string): Promise<string> {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── User-Agent Parser ────────────────────────────────────────────────────────
function parseUserAgent(ua: string): { deviceType: string; browserName: string; osName: string } {
  // OS detection
  let osName = 'Desconocido';
  if (/Windows NT 10/.test(ua)) osName = 'Windows 10/11';
  else if (/Windows NT 6\.3/.test(ua)) osName = 'Windows 8.1';
  else if (/Windows NT 6\.2/.test(ua)) osName = 'Windows 8';
  else if (/Windows NT 6\.1/.test(ua)) osName = 'Windows 7';
  else if (/Windows/.test(ua)) osName = 'Windows';
  else if (/iPhone OS/.test(ua)) { const v = ua.match(/iPhone OS ([\d_]+)/); osName = `iOS ${v ? v[1].replace(/_/g, '.') : ''}`; }
  else if (/iPad.*OS/.test(ua)) { const v = ua.match(/OS ([\d_]+)/); osName = `iPadOS ${v ? v[1].replace(/_/g, '.') : ''}`; }
  else if (/Android/.test(ua)) { const v = ua.match(/Android ([\d.]+)/); osName = `Android ${v ? v[1] : ''}`; }
  else if (/Mac OS X/.test(ua)) { const v = ua.match(/Mac OS X ([\d_]+)/); osName = `macOS ${v ? v[1].replace(/_/g, '.') : ''}`; }
  else if (/Linux/.test(ua)) osName = 'Linux';
  else if (/CrOS/.test(ua)) osName = 'Chrome OS';

  // Browser detection
  let browserName = 'Desconocido';
  if (/Edg\//.test(ua)) { const v = ua.match(/Edg\/([\d.]+)/); browserName = `Edge ${v ? v[1] : ''}`; }
  else if (/OPR\//.test(ua) || /Opera\//.test(ua)) { const v = ua.match(/OPR\/([\d.]+)/); browserName = `Opera ${v ? v[1] : ''}`; }
  else if (/SamsungBrowser/.test(ua)) { const v = ua.match(/SamsungBrowser\/([\d.]+)/); browserName = `Samsung Browser ${v ? v[1] : ''}`; }
  else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) { const v = ua.match(/Chrome\/([\d.]+)/); browserName = `Chrome ${v ? v[1] : ''}`; }
  else if (/Firefox\//.test(ua)) { const v = ua.match(/Firefox\/([\d.]+)/); browserName = `Firefox ${v ? v[1] : ''}`; }
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) { const v = ua.match(/Version\/([\d.]+)/); browserName = `Safari ${v ? v[1] : ''}`; }
  else if (/MSIE|Trident/.test(ua)) browserName = 'Internet Explorer';

  // Device type
  let deviceType = 'Escritorio';
  if (/iPhone/.test(ua)) deviceType = 'iPhone';
  else if (/iPad/.test(ua)) deviceType = 'iPad';
  else if (/Android/.test(ua) && /Mobile/.test(ua)) deviceType = 'Móvil Android';
  else if (/Android/.test(ua)) deviceType = 'Tablet Android';
  else if (/Mobile/.test(ua)) deviceType = 'Móvil';

  return { deviceType, browserName: browserName.trim(), osName: osName.trim() };
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SessionEvidence {
  user_agent: string;
  language: string;
  platform: string;
  screen: string;
  timezone: string;
  touch_points: number;
  geo: {
    latitude: number;
    longitude: number;
    accuracy_meters: number;
    source: string;
    country?: string;
    country_code?: string;
    region?: string;
    city?: string;
    formatted?: string;
  } | null;
}

interface DeviceFingerprint {
  visitor_id: string;
  fingerprint_id: string;
  canvas_hash?: string;
  webgl_vendor?: string;
  webgl_renderer?: string;
  audio_hash?: string;
  screen_resolution: string;
  language: string;
  cpu_cores: number;
  device_memory_gb?: number;
  touch_points: number;
  platform: string;
  plugins_count?: number;
}

interface FrameCapture {
  frame_id: string;
  event: string;
  timestamp: string;
  sha256: string;
  size_bytes: number;
  dataUrl: string;
  width: number;
  height: number;
}

interface HumanBehavior {
  human_score: number;
  anomaly_flags: string[];
  total_strokes: number;
  total_points: number;
  total_duration_ms: number;
  avg_speed_px_s: number;
  max_speed_px_s: number;
  avg_pressure: number;
}

interface ConstanciaData {
  evidence_id: string;
  image_sha256: string;
  strokes_sha256: string;
  combined_sha256: string;
  total_strokes: number;
  total_duration_ms: number;
  human_score: number;
  anomaly_flags: string[];
  avg_pressure: number;
  captured_at: string;
  ip_address: string;
  fingerprint_id: string;
  frames: FrameCapture[];
  chain_hash: string;
  otp_verified: boolean;
  geo?: { latitude: number; longitude: number } | null;
  signature_data_url?: string;
  device_type?: string;
  browser_name?: string;
  os_name?: string;
  biometric?: {
    selfie_sha256: string;
    face_match_score: number | null;
    face_match_verdict: string | null;
    method: string;
  };
}

interface BiometricEnrollment {
  hasEnrollment: boolean;
  createdAt?: string;
  faceMatchScore?: number;
  status?: string;
}

interface Props {
  documentId: string;
  userId: string;
  userToken: string;
  userEmail?: string;
  userName?: string;
  documentName?: string;
  isDark: boolean;
  onComplete: (firmaDataUrl: string) => void;
  onNoticeAccepted?: () => void;
}

// ─── Analyze human behavior ───────────────────────────────────────────────────
function analyzeHumanBehavior(strokes: any[]): HumanBehavior {
  const allPoints = strokes.flatMap((s: any) => s.points);
  const speeds: number[] = [];
  const flags: string[] = [];

  for (let i = 1; i < allPoints.length; i++) {
    const dt = (allPoints[i].t - allPoints[i - 1].t) / 1000;
    if (dt <= 0) continue;
    const dx = allPoints[i].x - allPoints[i - 1].x;
    const dy = allPoints[i].y - allPoints[i - 1].y;
    speeds.push(Math.sqrt(dx * dx + dy * dy) / dt);
  }

  let score = 1.0;
  const totalDuration = strokes.reduce((s: number, t: any) => s + (t.duration_ms || 0), 0);

  const variance = (arr: number[]) => {
    if (!arr.length) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  };

  if (speeds.length > 5 && variance(speeds) < 0.5) { score -= 0.35; flags.push('CONSTANT_SPEED'); }
  if (speeds.length && Math.max(...speeds) > 5000) { score -= 0.30; flags.push('SPEED_TOO_HIGH'); }
  if (allPoints.length < 10) { score -= 0.20; flags.push('TOO_FEW_POINTS'); }
  if (allPoints.every((p: any) => p.pressure === 1.0)) { score -= 0.25; flags.push('SYNTHETIC_PRESSURE'); }
  if (totalDuration < 500) { score -= 0.30; flags.push('DURATION_TOO_SHORT'); }

  const avgPressure = allPoints.length
    ? allPoints.reduce((s: number, p: any) => s + p.pressure, 0) / allPoints.length
    : 1.0;

  return {
    human_score: Math.max(0, Math.round(score * 100) / 100),
    anomaly_flags: flags,
    total_strokes: strokes.length,
    total_points: allPoints.length,
    total_duration_ms: totalDuration,
    avg_speed_px_s: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0,
    max_speed_px_s: speeds.length ? Math.max(...speeds) : 0,
    avg_pressure: Math.round(avgPressure * 1000) / 1000,
  };
}

// ─── Participation Certificate Component ──────────────────────────────────────
function ConstanciaParticipacion({
  isDark,
  documentName,
  userName,
  userEmail,
  capturedAt,
  evidenceId,
  otpVerified,
  humanScore,
  hasBiometric,
  constanciaData,
  onClose,
}: {
  isDark: boolean;
  documentName: string;
  userName: string;
  userEmail: string;
  capturedAt: string;
  evidenceId: string;
  otpVerified: boolean;
  humanScore: number;
  hasBiometric: boolean;
  constanciaData?: ConstanciaData | null;
  onClose: () => void;
}) {
  const [shareSuccess, setShareSuccess] = useState(false);
  const [pdfGenerating, setPdfGenerating] = useState(false);

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' }) +
        ' | '+ d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  };

  const shortId = evidenceId ? evidenceId.substring(0, 8).toUpperCase() : '—';
  const folioId = `DOCUBOX-IND-AUT-${new Date().getFullYear()}-${shortId}`;

  const handleDownload = async () => {
    setPdfGenerating(true);
    try {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');

      const safe = (str: string | null | undefined) => (str || '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');

      const pdfDoc = await PDFDocument.create();
      const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

      // Colors
      const black = rgb(0.05, 0.05, 0.05);
      const darkGray = rgb(0.2, 0.2, 0.2);
      const midGray = rgb(0.45, 0.45, 0.45);
      const lightGray = rgb(0.88, 0.88, 0.88);
      const veryLightGray = rgb(0.96, 0.96, 0.96);
      const white = rgb(1, 1, 1);
      const accentBlue = rgb(0.11, 0.47, 0.78);
      const green = rgb(0.13, 0.55, 0.13);
      const darkBg = rgb(0.08, 0.08, 0.12);
      const sectionBg = rgb(0.97, 0.97, 0.98);

      // ── Helper: add page ──────────────────────────────────────────────────────
      const addPage = () => {
        const p = pdfDoc.addPage([595, 842]);
        return { page: p, width: 595, height: 842 };
      };

      let { page, width, height } = addPage();
      let y = height;

      const margin = 40;
      const contentW = width - margin * 2;

      // ── Helper: new page if needed ────────────────────────────────────────────
      const ensureSpace = (needed: number) => {
        if (y - needed < 50) {
          const np = addPage();
          page = np.page;
          y = np.height - 30;
        }
      };

      // ── Helper: draw section heading ──────────────────────────────────────────
      const drawSectionHeading = (title: string) => {
        ensureSpace(30);
        page.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 20, color: darkBg });
        page.drawText(safe(title), { x: margin + 8, y: y - 12, size: 8, font: fontBold, color: white });
        y -= 26;
      };

      // ── Helper: draw two-column key-value row ─────────────────────────────────
      const drawKV = (label: string, value: string, mono = false) => {
        ensureSpace(22);
        const rowH = 18;
        page.drawRectangle({ x: margin, y: y - rowH, width: contentW, height: rowH, color: veryLightGray, borderColor: lightGray, borderWidth: 0.3 });
        page.drawText(safe(label), { x: margin + 6, y: y - 12, size: 7.5, font: fontBold, color: darkGray });
        const valStr = safe(value);
        const maxValLen = 72;
        const displayVal = valStr.length > maxValLen ? valStr.slice(0, maxValLen) + '...' : valStr;
        page.drawText(displayVal, { x: margin + 180, y: y - 12, size: 7.5, font: mono ? fontReg : fontReg, color: black });
        y -= rowH;
      };

      // ── Helper: draw table header row ─────────────────────────────────────────
      const drawTableHeader = (cols: { label: string; x: number; w: number }[]) => {
        ensureSpace(20);
        page.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 18, color: rgb(0.2, 0.2, 0.25) });
        for (const col of cols) {
          page.drawText(safe(col.label), { x: col.x, y: y - 12, size: 7, font: fontBold, color: white });
        }
        y -= 18;
      };

      // ── Helper: draw table data row ───────────────────────────────────────────
      const drawTableRow = (cells: { text: string; x: number; w: number }[], rowIndex: number) => {
        ensureSpace(18);
        const bg = rowIndex % 2 === 0 ? veryLightGray : white;
        page.drawRectangle({ x: margin, y: y - 16, width: contentW, height: 16, color: bg, borderColor: lightGray, borderWidth: 0.3 });
        for (const cell of cells) {
          const txt = safe(cell.text);
          const maxLen = Math.floor(cell.w / 5.5);
          const display = txt.length > maxLen ? txt.slice(0, maxLen) + '...' : txt;
          page.drawText(display, { x: cell.x, y: y - 11, size: 7, font: fontReg, color: darkGray });
        }
        y -= 16;
      };

      // ════════════════════════════════════════════════════════════════════════
      // PAGE 1
      // ════════════════════════════════════════════════════════════════════════

      // ── Top header bar ────────────────────────────────────────────────────────
      page.drawRectangle({ x: 0, y: height - 55, width, height: 55, color: darkBg });
      page.drawText('CONSTANCIA INDIVIDUAL DE PARTICIPACION', {
        x: margin, y: height - 22, size: 13, font: fontBold, color: white,
      });
      page.drawText('Documento confidencial - uso exclusivo del firmante', {
        x: margin, y: height - 36, size: 8, font: fontReg, color: rgb(0.75, 0.75, 0.85),
      });
      page.drawText('DOCUBOX', {
        x: width - 90, y: height - 28, size: 10, font: fontBold, color: accentBlue,
      });
      y = height - 55;

      // ── Confidential banner ───────────────────────────────────────────────────
      page.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 18, color: rgb(0.95, 0.95, 0.97), borderColor: rgb(0.6, 0.6, 0.7), borderWidth: 0.5 });
      page.drawText('CONFIDENCIAL - SOLO PARA EL FIRMANTE', {
        x: margin + 8, y: y - 12, size: 7.5, font: fontBold, color: rgb(0.3, 0.3, 0.4),
      });
      page.drawText('METODO: FIRMA AUTOGRAFA DIGITALIZADA', {
        x: margin + 280, y: y - 12, size: 7.5, font: fontBold, color: accentBlue,
      });
      y -= 22;

      // ── Folio / header table ──────────────────────────────────────────────────
      page.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 18, color: rgb(0.2, 0.2, 0.25) });
      page.drawText('FOLIO', { x: margin + 6, y: y - 12, size: 7, font: fontBold, color: white });
      page.drawText('GENERADA (UTC)', { x: margin + 200, y: y - 12, size: 7, font: fontBold, color: white });
      page.drawText('FIRMANTE', { x: margin + 370, y: y - 12, size: 7, font: fontBold, color: white });
      y -= 18;
      page.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 18, color: veryLightGray, borderColor: lightGray, borderWidth: 0.3 });
      page.drawText(safe(folioId), { x: margin + 6, y: y - 12, size: 7, font: fontReg, color: black });
      page.drawText(safe(capturedAt || new Date().toISOString()), { x: margin + 200, y: y - 12, size: 7, font: fontReg, color: black });
      page.drawText(safe(userEmail), { x: margin + 370, y: y - 12, size: 7, font: fontReg, color: black });
      y -= 24;

      // ── DATOS DEL PARTICIPANTE ────────────────────────────────────────────────
      drawSectionHeading('DATOS DEL PARTICIPANTE');
      drawKV('NOMBRE COMPLETO', userName);
      drawKV('CORREO', userEmail);
      drawKV('ROL', 'Firmante');
      y -= 8;

      // ── DATOS DEL DOCUMENTO ───────────────────────────────────────────────────
      drawSectionHeading('DATOS DEL DOCUMENTO');
      drawKV('TITULO', documentName);
      drawKV('SHA-256', constanciaData?.combined_sha256 || constanciaData?.image_sha256 || '-');
      y -= 8;

      // ── EVIDENCIA DE SESION ───────────────────────────────────────────────────
      drawSectionHeading('EVIDENCIA DE SESION - RECOLECCION AUTOMATICA');

      // Sub-heading: Red e Identidad
      ensureSpace(16);
      page.drawText('Red e Identidad', { x: margin + 6, y: y - 10, size: 7.5, font: fontBold, color: accentBlue });
      y -= 16;
      drawKV('IP DEL FIRMANTE', constanciaData?.ip_address || '-');
      let geo = constanciaData?.geo;
      drawKV('COORDENADAS', geo ? `${geo.latitude.toFixed(6)}, ${geo.longitude.toFixed(6)}` : '-');

      // Sub-heading: Sellado de Tiempo
      ensureSpace(16);
      page.drawText('Sellado de Tiempo', { x: margin + 6, y: y - 10, size: 7.5, font: fontBold, color: accentBlue });
      y -= 16;
      drawKV('TIMESTAMP UTC (SERVIDOR)', capturedAt || '-');

      // Sub-heading: Dispositivo
      ensureSpace(16);
      page.drawText('Dispositivo', { x: margin + 6, y: y - 10, size: 7.5, font: fontBold, color: accentBlue });
      y -= 16;
      drawKV('TIPO', constanciaData?.device_type || '-');
      drawKV('NAVEGADOR', constanciaData?.browser_name || '-');
      drawKV('SISTEMA', constanciaData?.os_name || '-');
      y -= 8;

      // ── Huella Digital del Dispositivo ────────────────────────────────────────
      drawSectionHeading('Huella Digital del Dispositivo');
      drawKV('FINGERPRINT ID', constanciaData?.fingerprint_id || '-', true);
      y -= 8;

      // ── Capturas de Pantalla del Proceso ─────────────────────────────────────
      drawSectionHeading('Capturas de Pantalla del Proceso');
      const framesCols = [
        { label: '#', x: margin + 6, w: 20 },
        { label: 'MOMENTO', x: margin + 30, w: 100 },
        { label: 'SHA-256', x: margin + 140, w: 240 },
        { label: 'TIMESTAMP', x: margin + 390, w: 120 },
      ];
      drawTableHeader(framesCols);
      const frames = constanciaData?.frames || [];
      if (frames.length === 0) {
        ensureSpace(18);
        page.drawRectangle({ x: margin, y: y - 16, width: contentW, height: 16, color: veryLightGray, borderColor: lightGray, borderWidth: 0.3 });
        page.drawText('Sin capturas registradas', { x: margin + 6, y: y - 11, size: 7, font: fontReg, color: midGray });
        y -= 16;
      } else {
        frames.slice(0, 3).forEach((f, i) => {
          drawTableRow([
            { text: String(i + 1), x: margin + 6, w: 20 },
            { text: f.event || '-', x: margin + 30, w: 100 },
            { text: f.sha256 || '-', x: margin + 140, w: 240 },
            { text: f.timestamp || '-', x: margin + 390, w: 120 },
          ], i);
        });
      }
      // Chain hash
      ensureSpace(20);
      page.drawRectangle({ x: margin, y: y - 18, width: contentW, height: 18, color: veryLightGray, borderColor: lightGray, borderWidth: 0.3 });
      page.drawText('CHAIN HASH', { x: margin + 6, y: y - 12, size: 7.5, font: fontBold, color: darkGray });
      const chainHashDisplay = safe(constanciaData?.chain_hash || '-');
      page.drawText(chainHashDisplay.length > 72 ? chainHashDisplay.slice(0, 72) + '...' : chainHashDisplay, { x: margin + 100, y: y - 12, size: 7, font: fontReg, color: black });
      y -= 24;

      // ── FIRMA AUTOGRAFA DIGITALIZADA ──────────────────────────────────────────
      drawSectionHeading('FIRMA AUTOGRAFA DIGITALIZADA');

      // Signature image
      const sigImgDataUrl = constanciaData?.signature_data_url;
      if (sigImgDataUrl && sigImgDataUrl.startsWith('data:image/png')) {
        try {
          ensureSpace(100);
          const base64 = sigImgDataUrl.split(',')[1];
          const imgBytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          const embeddedImg = await pdfDoc.embedPng(imgBytes);
          const imgW = 180;
          const imgH = 70;
          const imgX = margin + 6;
          page.drawRectangle({ x: imgX - 2, y: y - imgH - 6, width: imgW + 4, height: imgH + 4, color: white, borderColor: lightGray, borderWidth: 0.5 });
          page.drawImage(embeddedImg, { x: imgX, y: y - imgH - 4, width: imgW, height: imgH });
          y -= imgH + 14;
        } catch {
          // skip image
        }
      }

      // Signature data fields
      drawKV('IMAGEN SHA-256', constanciaData?.image_sha256 || '-', true);
      drawKV('VECTOR SHA-256', constanciaData?.strokes_sha256 || '-', true);
      drawKV('HASH COMBINADO', constanciaData?.combined_sha256 || '-', true);
      drawKV('TRAZOS', String(constanciaData?.total_strokes ?? '-'));
      drawKV('DURACION', constanciaData?.total_duration_ms ? `${(constanciaData.total_duration_ms / 1000).toFixed(2)} segundos` : '-');
      drawKV('SCORE HUMANIDAD', constanciaData?.human_score != null ? `${constanciaData.human_score.toFixed(2)} / 1.00` : '-');
      drawKV('FLAGS ANOMALIA', constanciaData?.anomaly_flags?.length ? constanciaData.anomaly_flags.join(', ') : 'Ninguno');
      drawKV('PRESION PROM.', constanciaData?.avg_pressure != null ? String(constanciaData.avg_pressure) : '-');
      y -= 6;

      // Legal note for autograph
      ensureSpace(30);
      page.drawRectangle({ x: margin, y: y - 26, width: contentW, height: 26, color: rgb(0.97, 0.98, 1), borderColor: rgb(0.7, 0.8, 0.95), borderWidth: 0.5 });
      page.drawText('La firma autografa fue capturada con mecanismos de deteccion de comportamiento humano conforme al Art. 97 del Codigo de Comercio de Mexico.', {
        x: margin + 6, y: y - 12, size: 6.5, font: fontReg, color: midGray,
      });
      page.drawText('El vector de trazos y la imagen se encuentran cifrados con AES-256 en custodia segura.', {
        x: margin + 6, y: y - 22, size: 6.5, font: fontReg, color: midGray,
      });
      y -= 32;

      // ── INTEGRIDAD Y VERIFICACION ─────────────────────────────────────────────
      drawSectionHeading('INTEGRIDAD Y VERIFICACION');
      drawKV('HASH DE ESTA CONSTANCIA', constanciaData?.combined_sha256 || evidenceId || '-', true);
      drawKV('ALGORITMO', 'SHA-256');
      drawKV('URL DE VERIFICACION', 'https://verificar.docubox.mx');
      y -= 6;

      // Verification URL
      ensureSpace(20);
      page.drawText(`https://verificar.docubox.mx?constancia=${safe(folioId)}&doc=${safe(evidenceId || '-')}`, {
        x: margin + 6, y: y - 10, size: 7, font: fontReg, color: accentBlue,
      });
      y -= 20;

      // ── FUNDAMENTO LEGAL ──────────────────────────────────────────────────────
      drawSectionHeading('FUNDAMENTO LEGAL');
      ensureSpace(60);
      const legalBlocks = [
        ['Confidencialidad:', 'Este documento contiene datos personales protegidos por la LFPDPPP. Su divulgacion a terceros no autorizados esta prohibida.'],
        ['Validez juridica:', 'Certifica la participacion y voluntad de firma conforme a los Arts. 89-97 del Codigo de Comercio, LFEA y NOM-151-SCFI-2016.'],
        ['No repudio:', 'Los elementos registrados constituyen prueba de la libre y expresa manifestacion de voluntad del firmante.'],
      ];
      for (const [label, text] of legalBlocks) {
        ensureSpace(24);
        page.drawText(safe(label), { x: margin + 6, y: y - 10, size: 7.5, font: fontBold, color: darkGray });
        page.drawText(safe(text), { x: margin + 6, y: y - 20, size: 7, font: fontReg, color: midGray });
        y -= 28;
      }

      // ── Footer ────────────────────────────────────────────────────────────────
      ensureSpace(30);
      page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: width - margin, y: y - 4 }, thickness: 0.5, color: lightGray });
      page.drawText('Generado por: DOCUBOX - https://docubox.mx', { x: margin, y: y - 16, size: 7, font: fontReg, color: midGray });
      page.drawText(`Generado automaticamente al momento de la firma - ${safe(capturedAt || new Date().toISOString())}`, {
        x: margin, y: y - 26, size: 7, font: fontReg, color: midGray,
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `constancia-participacion-${shortId}.pdf`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('[PDF] Error generating PDF:', err);
      // Fallback: plain text
      const text = [
        'CONSTANCIA INDIVIDUAL DE PARTICIPACION — DOCUBOX',
        `Folio: ${folioId}`,
        '',
        '--- DATOS DEL PARTICIPANTE ---',
        `NOMBRE COMPLETO: ${userName}`,
        `CORREO: ${userEmail}`,
        `ROL: Firmante`,
        '',
        '--- DATOS DEL DOCUMENTO ---',
        `TITULO: ${documentName}`,
        `SHA-256: ${constanciaData?.combined_sha256 || constanciaData?.image_sha256 || '—'}`,
        '',
        '--- EVIDENCIA DE SESION ---',
        `IP DEL FIRMANTE: ${constanciaData?.ip_address || '—'}`,
        `COORDENADAS: ${constanciaData?.geo ? `${constanciaData.geo.latitude}, ${constanciaData.geo.longitude}` : '—'}`,
        `TIMESTAMP UTC (SERVIDOR): ${capturedAt}`,
        `TIPO: ${constanciaData?.device_type || '—'}`,
        `NAVEGADOR: ${constanciaData?.browser_name || '—'}`,
        `SISTEMA: ${constanciaData?.os_name || '—'}`,
        '',
        '--- HUELLA DIGITAL ---',
        `FINGERPRINT ID: ${constanciaData?.fingerprint_id || '—'}`,
        '',
        '--- FIRMA AUTOGRAFA DIGITALIZADA ---',
        `IMAGEN SHA-256: ${constanciaData?.image_sha256 || '—'}`,
        `VECTOR SHA-256: ${constanciaData?.strokes_sha256 || '—'}`,
        `HASH COMBINADO: ${constanciaData?.combined_sha256 || '—'}`,
        `TRAZOS: ${constanciaData?.total_strokes ?? '—'}`,
        `DURACION: ${constanciaData?.total_duration_ms ? (constanciaData.total_duration_ms / 1000).toFixed(2) + ' segundos' : '—'}`,
        `SCORE HUMANIDAD: ${constanciaData?.human_score != null ? constanciaData.human_score.toFixed(2) + ' / 1.00' : '—'}`,
        `FLAGS ANOMALIA: ${constanciaData?.anomaly_flags?.length ? constanciaData.anomaly_flags.join(', ') : 'Ninguno'}`,
        '',
        '--- INTEGRIDAD Y VERIFICACION ---',
        `HASH: ${constanciaData?.combined_sha256 || evidenceId}`,
        `ALGORITMO: SHA-256`,
        `URL: https://verificar.docubox.mx`,
        '',
        'Generado por: DOCUBOX - https://docubox.mx',
        `Generado automaticamente al momento de la firma - ${capturedAt || new Date().toISOString()}`,
      ].join('\n');
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `constancia-participacion-${shortId}.txt`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setPdfGenerating(false);
    }
  };

  const handleShare = async () => {
    const shareText = `Constancia de participación en firma\nDocumento: ${documentName}\nParticipante: ${userName}\nFecha: ${formatDate(capturedAt)}\nFolio: ${folioId}\nEmitida por DOCUBOX`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Constancia de Participación — DOCUBOX', text: shareText });
      } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(shareText).catch(() => {});
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2500);
    }
  };

  let geo = constanciaData?.geo;

  return (
    <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-900' : 'border-slate-200 bg-white'}`}>
      {/* ── Header ── */}
      <div className={`px-5 py-4 ${isDark ? 'bg-gray-950' : 'bg-slate-900'}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white tracking-wide">CONSTANCIA INDIVIDUAL DE PARTICIPACIÓN</h2>
            <p className="text-xs text-slate-400 mt-0.5">Documento confidencial — uso exclusivo del firmante</p>
          </div>
          <span className="text-xs font-bold text-blue-400 flex-shrink-0">DOCUBOX</span>
        </div>
        <div className={`mt-3 flex items-center justify-between px-3 py-1.5 rounded text-xs font-semibold ${isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-800 text-slate-200'}`}>
          <span>■ CONFIDENCIAL · SOLO PARA EL FIRMANTE</span>
          <span className="text-blue-400">MÉTODO: FIRMA AUTÓGRAFA DIGITALIZADA</span>
        </div>
      </div>

      {/* ── Folio row ── */}
      <div className={`grid grid-cols-3 border-b text-xs ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-slate-50'}`}>
        {[
          { label: 'FOLIO', value: folioId },
          { label: 'GENERADA (UTC)', value: capturedAt || '—' },
          { label: 'FIRMANTE', value: userEmail },
        ].map(({ label, value }) => (
          <div key={label} className={`px-3 py-2 border-r last:border-r-0 ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>{label}</p>
            <p className={`font-mono text-[10px] break-all ${isDark ? 'text-gray-200' : 'text-slate-700'}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="divide-y divide-slate-200 dark:divide-gray-700">
        {/* ── DATOS DEL PARTICIPANTE ── */}
        <CertSection title="DATOS DEL PARTICIPANTE" isDark={isDark}>
          <CertKVTable isDark={isDark} rows={[
            ['NOMBRE COMPLETO', userName],
            ['CORREO', userEmail],
            ['ROL', 'Firmante'],
          ]} />
        </CertSection>

        {/* ── DATOS DEL DOCUMENTO ── */}
        <CertSection title="DATOS DEL DOCUMENTO" isDark={isDark}>
          <CertKVTable isDark={isDark} rows={[
            ['TÍTULO', documentName],
            ['SHA-256', constanciaData?.combined_sha256 || constanciaData?.image_sha256 || '—'],
          ]} />
        </CertSection>

        {/* ── EVIDENCIA DE SESIÓN ── */}
        <CertSection title="EVIDENCIA DE SESIÓN · RECOLECCIÓN AUTOMÁTICA" isDark={isDark}>
          <p className={`text-[10px] font-semibold mb-1 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Red e Identidad</p>
          <CertKVTable isDark={isDark} rows={[
            ['IP DEL FIRMANTE', constanciaData?.ip_address || '—'],
            ['COORDENADAS', geo ? `${geo.latitude.toFixed(6)}, ${geo.longitude.toFixed(6)}` : '—'],
          ]} />
          <p className={`text-[10px] font-semibold mt-2 mb-1 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Sellado de Tiempo</p>
          <CertKVTable isDark={isDark} rows={[
            ['TIMESTAMP UTC (SERVIDOR)', capturedAt || '—'],
          ]} />
          <p className={`text-[10px] font-semibold mt-2 mb-1 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>Dispositivo</p>
          <CertKVTable isDark={isDark} rows={[
            ['TIPO', constanciaData?.device_type || '—'],
            ['NAVEGADOR', constanciaData?.browser_name || '—'],
            ['SISTEMA', constanciaData?.os_name || '—'],
          ]} />
        </CertSection>

        {/* ── HUELLA DIGITAL ── */}
        <CertSection title="Huella Digital del Dispositivo" isDark={isDark}>
          <CertKVTable isDark={isDark} rows={[
            ['FINGERPRINT ID', constanciaData?.fingerprint_id || '—'],
          ]} mono />
        </CertSection>

        {/* ── CAPTURAS DE PANTALLA ── */}
        <CertSection title="Capturas de Pantalla del Proceso" isDark={isDark}>
          <div className={`rounded border overflow-hidden text-[10px] ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
            <div className={`grid grid-cols-4 px-2 py-1.5 font-bold uppercase tracking-wide ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-slate-700 text-white'}`}>
              <span>#</span>
              <span>MOMENTO</span>
              <span className="col-span-2">SHA-256</span>
            </div>
            {(constanciaData?.frames || []).length === 0 ? (
              <div className={`px-2 py-2 ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>Sin capturas registradas</div>
            ) : (
              (constanciaData?.frames || []).slice(0, 3).map((f, i) => (
                <div key={i} className={`grid grid-cols-4 px-2 py-1.5 border-t ${isDark ? 'border-gray-700 odd:bg-gray-800 even:bg-gray-900' : 'border-slate-100 odd:bg-white even:bg-slate-50'}`}>
                  <span className={isDark ? 'text-gray-300' : 'text-slate-600'}>{i + 1}</span>
                  <span className={isDark ? 'text-gray-300' : 'text-slate-600'}>{f.event || '—'}</span>
                  <span className={`col-span-2 font-mono break-all ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>{f.sha256 ? f.sha256.slice(0, 32) + '...' : '—'}</span>
                </div>
              ))
            )}
          </div>
          {constanciaData?.chain_hash && (
            <div className={`mt-2 flex items-start gap-2 px-2 py-1.5 rounded text-[10px] ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-slate-50 border border-slate-200'}`}>
              <span className={`font-bold flex-shrink-0 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>CHAIN HASH</span>
              <span className={`font-mono break-all ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>{constanciaData.chain_hash}</span>
            </div>
          )}
        </CertSection>

        {/* ── FIRMA AUTÓGRAFA DIGITALIZADA ── */}
        <CertSection title="FIRMA AUTÓGRAFA DIGITALIZADA" isDark={isDark}>
          {constanciaData?.signature_data_url && (
            <div className={`flex justify-center mb-3 p-3 rounded border ${isDark ? 'bg-white border-gray-600' : 'bg-gray-50 border-slate-200'}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={constanciaData.signature_data_url} alt="Firma autógrafa digital" className="max-h-20 object-contain" />
            </div>
          )}
          <CertKVTable isDark={isDark} rows={[
            ['IMAGEN SHA-256', constanciaData?.image_sha256 || '—'],
            ['VECTOR SHA-256', constanciaData?.strokes_sha256 || '—'],
            ['HASH COMBINADO', constanciaData?.combined_sha256 || '—'],
            ['TRAZOS', String(constanciaData?.total_strokes ?? '—')],
            ['DURACIÓN', constanciaData?.total_duration_ms ? `${(constanciaData.total_duration_ms / 1000).toFixed(2)} segundos` : '—'],
            ['SCORE HUMANIDAD', constanciaData?.human_score != null ? `${constanciaData.human_score.toFixed(2)} / 1.00` : '—'],
            ['FLAGS ANOMALÍA', constanciaData?.anomaly_flags?.length ? constanciaData.anomaly_flags.join(', ') : 'Ninguno'],
            ['PRESIÓN PROM.', constanciaData?.avg_pressure != null ? String(constanciaData.avg_pressure) : '—'],
          ]} mono />
          <p className={`mt-2 text-[10px] leading-relaxed ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>
            La firma autógrafa fue capturada con mecanismos de detección de comportamiento humano conforme al Art. 97 del Código de Comercio de México. El vector de trazos y la imagen se encuentran cifrados con AES-256 en custodia segura.
          </p>
        </CertSection>

        {/* ── INTEGRIDAD Y VERIFICACIÓN ── */}
        <CertSection title="INTEGRIDAD Y VERIFICACIÓN" isDark={isDark}>
          <CertKVTable isDark={isDark} rows={[
            ['HASH DE ESTA CONSTANCIA', constanciaData?.combined_sha256 || evidenceId || '—'],
            ['ALGORITMO', 'SHA-256'],
            ['URL DE VERIFICACIÓN', 'https://verificar.docubox.mx'],
          ]} mono />
          <p className={`mt-2 text-[10px] font-mono break-all ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
            {`https://verificar.docubox.mx?constancia=${folioId}&doc=${evidenceId || '—'}`}
          </p>
        </CertSection>

        {/* ── FUNDAMENTO LEGAL ── */}
        <CertSection title="FUNDAMENTO LEGAL" isDark={isDark}>
          {[
            ['Confidencialidad:', 'Este documento contiene datos personales protegidos por la LFPDPPP. Su divulgación a terceros no autorizados está prohibida.'],
            ['Validez jurídica:', 'Certifica la participación y voluntad de firma conforme a los Arts. 89–97 del Código de Comercio, LFEA y NOM-151-SCFI-2016.'],
            ['No repudio:', 'Los elementos registrados constituyen prueba de la libre y expresa manifestación de voluntad del firmante.'],
          ].map(([label, text]) => (
            <div key={label} className="mb-2">
              <span className={`text-[10px] font-bold ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>{label} </span>
              <span className={`text-[10px] ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>{text}</span>
            </div>
          ))}
        </CertSection>
      </div>

      {/* ── Footer ── */}
      <div className={`px-4 py-3 text-[10px] border-t ${isDark ? 'border-gray-700 bg-gray-900 text-gray-500' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
        <p>Generado por: DOCUBOX · https://docubox.mx</p>
        <p>Generado automáticamente al momento de la firma · {capturedAt || '—'}</p>
      </div>

      {/* ── Actions ── */}
      <div className={`px-5 py-4 border-t flex flex-col gap-2 ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDownload}
            disabled={pdfGenerating}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium border rounded-xl transition-colors disabled:opacity-60 ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {pdfGenerating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {pdfGenerating ? 'Generando PDF…' : 'Descargar constancia (PDF)'}
          </button>
          <button
            type="button"
            onClick={handleShare}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium border rounded-xl transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            <Share2 size={14} />
            {shareSuccess ? '¡Copiado!' : 'Compartir'}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 transition-colors"
        >
          <Check size={14} />
          Finalizar
        </button>
      </div>
    </div>
  );
}

// ─── Certificate sub-components ───────────────────────────────────────────────
function CertSection({ title, isDark, children }: { title: string; isDark: boolean; children: React.ReactNode }) {
  return (
    <div className={`${isDark ? 'bg-gray-900' : 'bg-white'}`}>
      <div className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider ${isDark ? 'bg-gray-800 text-gray-300' : 'bg-slate-800 text-white'}`}>
        {title}
      </div>
      <div className="px-4 py-3">
        {children}
      </div>
    </div>
  );
}

function CertKVTable({ rows, isDark, mono = false }: { rows: [string, string][]; isDark: boolean; mono?: boolean }) {
  return (
    <div className={`rounded border overflow-hidden text-[10px] ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
      {rows.map(([label, value], i) => (
        <div key={label} className={`flex border-b last:border-b-0 ${isDark ? 'border-gray-700 odd:bg-gray-800 even:bg-gray-900' : 'border-slate-100 odd:bg-white even:bg-slate-50'}`}>
          <div className={`w-36 flex-shrink-0 px-2 py-1.5 font-bold ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>{label}</div>
          <div className={`flex-1 px-2 py-1.5 break-all ${mono ? 'font-mono' : ''} ${isDark ? 'text-gray-200' : 'text-slate-700'}`}>{value || '—'}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Biometric Check Modal ────────────────────────────────────────────────────
function BiometricCheckModal({
  isDark,
  userId,
  onSkip,
  onProceedWithBiometric,
}: {
  isDark: boolean;
  userId: string;
  onSkip: () => void;
  onProceedWithBiometric: (mode: 'same_device' | 'mobile', hasIne: boolean) => void;
}) {
  const [checkState, setCheckState] = useState<'checking' | 'found' | 'not_found'>('checking');
  const [enrollment, setEnrollment] = useState<BiometricEnrollment | null>(null);
  const [showDeviceChoice, setShowDeviceChoice] = useState(false);
  const [pcErrorVisible, setPcErrorVisible] = useState(false);
  // Track whether user has a stored ID capture (from id_capture_logs)
  const [hasStoredIdCapture, setHasStoredIdCapture] = useState(false);
  const [storedIdCaptureDate, setStoredIdCaptureDate] = useState<string | null>(null);

  useEffect(() => {
    const checkEnrollment = async () => {
      try {
        const supabase = createClient();

        // 1. Check enrollment_results
        const { data } = await supabase
          .from('enrollment_results')
          .select('id, created_at, face_match_score, status')
          .eq('user_id', userId)
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        // 2. Also check id_capture_logs for a previously stored identification
        const { data: idLog } = await supabase
          .from('id_capture_logs')
          .select('id, captured_at, anverso_b64')
          .eq('user_id', userId)
          .not('anverso_b64', 'is', null)
          .order('captured_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (idLog?.anverso_b64) {
          setHasStoredIdCapture(true);
          setStoredIdCaptureDate(idLog.captured_at || null);
        }

        if (data) {
          setEnrollment({
            hasEnrollment: true,
            createdAt: data.created_at,
            faceMatchScore: data.face_match_score,
            status: data.status,
          });
          setCheckState('found');
        } else {
          setEnrollment({ hasEnrollment: false });
          setCheckState('not_found');
        }
      } catch {
        setEnrollment({ hasEnrollment: false });
        setCheckState('not_found');
      }
    };
    checkEnrollment();
  }, [userId]);

  if (checkState === 'checking') {
    return (
      <div className={`rounded-xl border p-5 flex flex-col items-center gap-3 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <Loader2 size={22} className="animate-spin text-primary" />
        <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>Verificando identificación biométrica registrada…</p>
      </div>
    );
  }

  // Combined: has enrollment OR has stored id_capture
  const hasAnyStoredId = enrollment?.hasEnrollment || hasStoredIdCapture;

  if (showDeviceChoice) {
    return (
      <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <div className={`px-4 py-3 border-b flex items-center gap-2 ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
          <Camera size={15} className="text-primary" />
          <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>¿Cómo deseas tomar la prueba de vida?</p>
        </div>
        <div className="p-4 space-y-3">
          <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
            Se generará una selfie en tiempo real para validar tu identidad como prueba de vida.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                if (!hasAnyStoredId) {
                  setPcErrorVisible(true);
                  return;
                }
                onProceedWithBiometric('same_device', hasAnyStoredId);
              }}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${isDark ? 'border-primary/50 bg-primary/10 hover:bg-primary/20 text-gray-200' : 'border-primary/30 bg-primary/5 hover:bg-primary/10 text-slate-700'}`}
            >
              <Monitor size={22} className="text-primary" />
              <span className="text-xs font-semibold">Este equipo</span>
              <span className={`text-[10px] text-center ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>Usar la cámara de este dispositivo</span>
            </button>
            <button
              type="button"
              onClick={() => { setPcErrorVisible(false); onProceedWithBiometric('mobile', hasAnyStoredId); }}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${isDark ? 'border-teal-500/50 bg-teal-900/20 hover:bg-teal-900/30 text-gray-200' : 'border-teal-300 bg-teal-50 hover:bg-teal-100 text-slate-700'}`}
            >
              <Smartphone size={22} className="text-teal-600" />
              <span className="text-xs font-semibold">Dispositivo móvil</span>
              <span className={`text-[10px] text-center ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>Escanear QR con tu celular</span>
            </button>
          </div>

          {/* Error: no stored id + chose PC */}
          {pcErrorVisible && (
            <div className={`rounded-lg p-3 flex items-start gap-2 ${isDark ? 'bg-red-900/20 border border-red-700' : 'bg-red-50 border border-red-200'}`}>
              <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className={`text-xs font-semibold ${isDark ? 'text-red-400' : 'text-red-700'}`}>
                  Identificación requerida
                </p>
                <p className={`text-[11px] mt-0.5 ${isDark ? 'text-red-400/80' : 'text-red-600'}`}>
                  Para realizar la prueba de vida en este equipo necesitas tener una identificación registrada. Deberás cargar tu identificación y realizar la prueba de vida desde tu teléfono móvil.
                </p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onSkip}
            className={`w-full text-xs py-2 transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Omitir prueba de vida
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
      <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
        <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>¿Deseas agregar prueba de vida?</p>
      </div>
      <div className="p-4 space-y-3">
        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
          Vincular tu identidad visual al documento agrega valor probatorio adicional. ¿Deseas generar una prueba de vida al firmar?
        </p>

        {/* Enrollment / stored ID status */}
        {checkState === 'found' && enrollment?.hasEnrollment ? (
          <div className={`rounded-lg p-3 flex items-start gap-2 ${isDark ? 'bg-green-900/20 border border-green-700' : 'bg-green-50 border border-green-200'}`}>
            <Shield size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className={`text-xs font-semibold ${isDark ? 'text-green-400' : 'text-green-700'}`}>
                ✅ Identificación biométrica registrada
              </p>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-green-500/80' : 'text-green-600'}`}>
                Cuenta con una identificación biométrica registrada. Se generará la toma de prueba de vida mediante selfie.
              </p>
              {enrollment.createdAt && (
                <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>
                  Registrada: {new Date(enrollment.createdAt).toLocaleDateString('es-MX')}
                  {enrollment.faceMatchScore ? ` · Score: ${enrollment.faceMatchScore}%` : ''}
                </p>
              )}
            </div>
          </div>
        ) : hasStoredIdCapture ? (
          <div className={`rounded-lg p-3 flex items-start gap-2 ${isDark ? 'bg-blue-900/20 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
            <Shield size={15} className="text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className={`text-xs font-semibold ${isDark ? 'text-blue-400' : 'text-blue-700'}`}>
                ✅ Identificación precargada disponible
              </p>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-blue-500/80' : 'text-blue-600'}`}>
                Se encontró una identificación previamente registrada. Solo necesitarás tomar una selfie para la prueba de vida.
              </p>
              {storedIdCaptureDate && (
                <p className={`text-[10px] mt-1 ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>
                  Capturada: {new Date(storedIdCaptureDate).toLocaleDateString('es-MX')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className={`rounded-lg p-3 flex items-start gap-2 ${isDark ? 'bg-amber-900/20 border border-amber-700' : 'bg-amber-50 border border-amber-200'}`}>
            <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className={`text-xs font-semibold ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>
                Sin identificación registrada
              </p>
              <p className={`text-[11px] mt-0.5 ${isDark ? 'text-amber-500/80' : 'text-amber-600'}`}>
                No se encontró una identificación registrada. Puedes agregarla junto con la prueba de vida o continuar sin prueba de vida.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setShowDeviceChoice(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
          >
            <Camera size={15} />
            Generar prueba de vida
          </button>
          <button
            type="button"
            onClick={onSkip}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl border transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            <ChevronRight size={15} />
            Continuar sin prueba de vida
          </button>
        </div>
        <p className={`text-xs text-center ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>
          La verificación biométrica es opcional. Tu documento tendrá plena validez sin ella.
        </p>
      </div>
    </div>
  );
}

// ─── QR Mobile Biometric Modal ────────────────────────────────────────────────
function QRMobileBiometricModal({
  isDark,
  documentId,
  userId,
  hasEnrollment,
  onComplete,
  onSkip,
}: {
  isDark: boolean;
  documentId: string;
  userId: string;
  hasEnrollment: boolean;
  onComplete: (selfieB64: string, method: string, metadata?: any) => void;
  onSkip: () => void;
}) {
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [status, setStatus] = useState<'generating' | 'waiting' | 'completed' | 'result' | 'error'>('generating');
  const realtimeChannelRef = useRef<ReturnType<typeof createClient> extends { channel: (...args: any[]) => infer R } ? R : any>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  // Countdown timer: session expires in 10 minutes
  const [timeLeft, setTimeLeft] = useState<number>(10 * 60);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiresAtRef = useRef<Date | null>(null);
  const [manualChecking, setManualChecking] = useState(false);
  // Store session result for display
  const [sessionResult, setSessionResult] = useState<{
    selfie: string;
    metadata: any;
    curpMatch: boolean | null;
    curpExtracted: string | null;
    curpProfile: string | null;
    nubariumAprobado: boolean | null;
    nubariumSimilitud: number | null;
    identityMatch: boolean | null;
    identityFailed: boolean;
  } | null>(null);
  // Keep a stable ref to onComplete so the realtime handler never needs to restart
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // ── Helper: process a completed session row ──────────────────────────────
  const processCompletedSession = useCallback((data: { status: string; file_url?: string | null; file_data?: string | null; metadata?: any }) => {
    const sessionStatus = data.status;
    if (sessionStatus !== 'completed' && sessionStatus !== 'identity_failed') return;

    // Tear down realtime channel and timer
    if (realtimeChannelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    if (timerRef.current) clearInterval(timerRef.current);

    const selfie = data.file_data || data.file_url || '';
    const meta = data.metadata ?? null;

    let curpMatch: boolean | null = meta?.curp_match ?? null;
    const curpExtracted: string | null = meta?.curp_extracted ?? null;
    const curpProfile: string | null = meta?.user_profile_compared?.curp ?? null;
    const nubariumAprobado: boolean | null = meta?.nubarium_aprobado ?? null;
    const nubariumSimilitud: number | null = typeof meta?.nubarium_similitud === 'number' ? meta.nubarium_similitud : null;
    const identityMatch: boolean | null = meta?.identity_match ?? null;
    const identityFailed = sessionStatus === 'identity_failed';

    setSessionResult({
      selfie,
      metadata: meta,
      curpMatch,
      curpExtracted,
      curpProfile,
      nubariumAprobado,
      nubariumSimilitud,
      identityMatch,
      identityFailed,
    });

    setStatus('result');
  }, []);

  useEffect(() => {
    const createSession = async () => {
      try {
        const res = await fetch('/api/mobile-upload/create-id-capture-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId, userId, hasEnrollment }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          console.error('[QR] Session creation failed:', errData);
          setStatus('error');
          return;
        }
        const data = await res.json();
        if (data.token) {
          setSessionToken(data.token);
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
          const url = `${siteUrl}/captura-id-movil/${data.token}`;
          setQrUrl(url);
          setStatus('waiting');
          // Set expiry time (15 minutes from now)
          const expiry = data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 15 * 60 * 1000);
          expiresAtRef.current = expiry;
          const initialLeft = Math.max(0, Math.floor((expiry.getTime() - Date.now()) / 1000));
          setTimeLeft(initialLeft);
        } else {
          console.error('[QR] No token in response:', data);
          setStatus('error');
        }
      } catch (err) {
        console.error('[QR] Fetch error:', err);
        setStatus('error');
      }
    };
    createSession();
    return () => {
      if (realtimeChannelRef.current) {
        const supabase = createClient();
        supabase.removeChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [documentId, userId]);

  // Generate QR data URL once we have the target URL
  useEffect(() => {
    if (status !== 'waiting' || !qrUrl) return;
    QRCode.toDataURL(qrUrl, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    }).then((dataUrl) => {
      setQrDataUrl(dataUrl);
    }).catch((err) => {
      console.error('[QR] toDataURL error:', err);
      // Fallback: try canvas
      if (canvasRef.current) {
        QRCode.toCanvas(canvasRef.current, qrUrl, { width: 200, margin: 2 }).catch(() => {});
      }
    });
  }, [status, qrUrl]);

  // ── Realtime subscription: react instantly when mobile session completes ──
  useEffect(() => {
    if (status !== 'waiting' || !sessionToken) return;

    const supabase = createClient();

    // One-time fallback check: in case the session was already completed
    // before the subscription was set up (race condition guard)
    supabase
      .from('mobile_upload_sessions')
      .select('status, file_url, file_data, metadata')
      .eq('token', sessionToken)
      .maybeSingle()
      .then(({ data }) => {
        if (data && (data.status === 'completed' || data.status === 'identity_failed')) {
          processCompletedSession(data);
        }
      });

    // Subscribe to realtime UPDATE events on this specific session row
    const channelName = `id-capture-session-${sessionToken}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'mobile_upload_sessions',
          filter: `token=eq.${sessionToken}`,
        },
        (payload) => {
          const row = payload.new as { status: string; file_url?: string | null; file_data?: string | null; metadata?: any };
          if (row.status === 'completed' || row.status === 'identity_failed') {
            processCompletedSession(row);
          }
        }
      )
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === 'SUBSCRIBED') {
          console.log('[Realtime] Subscribed to session:', sessionToken);
        } else if (subscribeStatus === 'CHANNEL_ERROR' || subscribeStatus === 'TIMED_OUT') {
          console.warn('[Realtime] Channel issue, status:', subscribeStatus);
        }
      });

    realtimeChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      realtimeChannelRef.current = null;
    };
  // processCompletedSession is stable (useCallback with no deps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sessionToken]);

  // Countdown timer
  useEffect(() => {
    if (status !== 'waiting') return;
    timerRef.current = setInterval(() => {
      if (expiresAtRef.current) {
        const left = Math.max(0, Math.floor((expiresAtRef.current.getTime() - Date.now()) / 1000));
        setTimeLeft(left);
        if (left === 0) {
          clearInterval(timerRef.current!);
        }
      } else {
        setTimeLeft(prev => {
          const next = Math.max(0, prev - 1);
          if (next === 0) clearInterval(timerRef.current!);
          return next;
        });
      }
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const isExpired = timeLeft === 0 && status === 'waiting';

  const handleProceedFromResult = () => {
    if (!sessionResult) return;
    setStatus('completed');
    onCompleteRef.current(sessionResult.selfie, 'mobile_id_capture', sessionResult.metadata);
  };

  const handleRegenerateQR = async () => {
    // Tear down existing realtime channel and timer
    if (realtimeChannelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    // Reset state to start fresh
    setQrUrl(null);
    setQrDataUrl(null);
    setSessionToken(null);
    setTimeLeft(10 * 60);
    expiresAtRef.current = null;
    setStatus('generating');
    // Create a new session
    try {
      const res = await fetch('/api/mobile-upload/create-id-capture-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, userId, hasEnrollment }),
      });
      if (!res.ok) {
        setStatus('error');
        return;
      }
      const data = await res.json();
      if (data.token) {
        setSessionToken(data.token);
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
        const url = `${siteUrl}/captura-id-movil/${data.token}`;
        setQrUrl(url);
        setStatus('waiting');
        const expiry = data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 15 * 60 * 1000);
        expiresAtRef.current = expiry;
        const initialLeft = Math.max(0, Math.floor((expiry.getTime() - Date.now()) / 1000));
        setTimeLeft(initialLeft);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
      <div className={`px-4 py-3 border-b flex items-center gap-2 ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
        <QrCode size={15} className="text-teal-600" />
        <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>Captura de identificación y prueba de vida — Móvil</p>
      </div>
      <div className="p-4 space-y-3">
        {status === 'generating' && (
          <div className="flex flex-col items-center gap-2 py-4">
            <Loader2 size={22} className="animate-spin text-primary" />
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>Generando código QR…</p>
          </div>
        )}
        {status === 'waiting' && qrUrl && (
          <>
            <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
              {hasEnrollment
                ? 'Escanea el código QR con tu dispositivo móvil para capturar tu selfie de prueba de vida.' :'Escanea el código QR con tu dispositivo móvil para capturar el anverso y reverso de tu identificación y tu selfie de prueba de vida.'}
            </p>
            <div className="flex justify-center">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="Código QR para captura móvil"
                  width={200}
                  height={200}
                  className="rounded-lg border border-slate-200"
                />
              ) : (
                <canvas
                  ref={canvasRef}
                  className="rounded-lg border border-slate-200"
                  style={{ width: 200, height: 200 }}
                />
              )}
            </div>
            {/* Countdown timer */}
            <div className={`flex items-center justify-center gap-2 text-xs rounded-lg px-3 py-2 ${isExpired ? (isDark ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-600') : timeLeft < 120 ? (isDark ? 'bg-amber-900/20 text-amber-400' : 'bg-amber-50 text-amber-600') : (isDark ? 'bg-gray-700 text-gray-400' : 'bg-slate-50 text-slate-500')}`}>
              <Clock size={12} />
              {isExpired
                ? 'El código QR ha expirado. Omite o genera uno nuevo.'
                : `Tiempo restante: ${formatTime(timeLeft)}`}
            </div>
            {isExpired && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleRegenerateQR}
                  className={`text-xs font-medium underline underline-offset-2 transition-colors ${isDark ? 'text-teal-400 hover:text-teal-300' : 'text-teal-600 hover:text-teal-700'}`}
                >
                  Generar nuevo código
                </button>
              </div>
            )}
            {!isExpired && (
              <div className={`flex items-center gap-2 text-xs justify-center ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                <RefreshCw size={11} className="animate-spin" />
                Esperando captura en tiempo real…
              </div>
            )}
            <p className={`text-[10px] text-center break-all ${isDark ? 'text-gray-600' : 'text-slate-300'}`}>{qrUrl}</p>
          </>
        )}

        {/* ── Result screen: shows CURP match + biometric result ── */}
        {status === 'result' && sessionResult && (
          <div className="space-y-3">
            {/* Biometric result */}
            <div className={`rounded-xl border p-3 space-y-2 ${
              sessionResult.identityFailed
                ? (isDark ? 'border-red-700 bg-red-900/20' : 'border-red-200 bg-red-50')
                : sessionResult.nubariumAprobado
                ? (isDark ? 'border-green-700 bg-green-900/20' : 'border-green-200 bg-green-50')
                : (isDark ? 'border-amber-700 bg-amber-900/20' : 'border-amber-200 bg-amber-50')
            }`}>
              <div className="flex items-center gap-2">
                {sessionResult.identityFailed || sessionResult.nubariumAprobado === false ? (
                  <AlertTriangle size={16} className={isDark ? 'text-red-400' : 'text-red-500'} />
                ) : sessionResult.nubariumAprobado ? (
                  <CheckCircle2 size={16} className={isDark ? 'text-green-400' : 'text-green-600'} />
                ) : (
                  <Shield size={16} className={isDark ? 'text-amber-400' : 'text-amber-500'} />
                )}
                <p className={`text-xs font-semibold ${
                  sessionResult.identityFailed || sessionResult.nubariumAprobado === false
                    ? (isDark ? 'text-red-300' : 'text-red-700')
                    : sessionResult.nubariumAprobado
                    ? (isDark ? 'text-green-300' : 'text-green-700')
                    : (isDark ? 'text-amber-300' : 'text-amber-700')
                }`}>
                  {sessionResult.identityFailed
                    ? 'Prueba de vida — Identidad no coincidente'
                    : sessionResult.nubariumAprobado
                    ? 'Prueba de vida — Identidad verificada'
                    : sessionResult.nubariumAprobado === false
                    ? 'Prueba de vida — No verificada'
                    : 'Prueba de vida — Procesada'}
                </p>
              </div>
              {sessionResult.nubariumSimilitud !== null && (
                <div className={`flex justify-between text-xs border-t pt-1.5 ${
                  sessionResult.identityFailed || sessionResult.nubariumAprobado === false
                    ? (isDark ? 'border-red-700 text-red-400' : 'border-red-200 text-red-600')
                    : sessionResult.nubariumAprobado
                    ? (isDark ? 'border-green-700 text-green-400' : 'border-green-200 text-green-600')
                    : (isDark ? 'border-amber-700 text-amber-400' : 'border-amber-200 text-amber-600')
                }`}>
                  <span>Similitud facial</span>
                  <span className="font-semibold">{sessionResult.nubariumSimilitud.toFixed(2)}%</span>
                </div>
              )}
            </div>

            {/* CURP match result */}
            {(sessionResult.curpMatch !== null || sessionResult.curpExtracted) && (
              <div className={`rounded-xl border p-3 space-y-2 ${
                sessionResult.curpMatch === true
                  ? (isDark ? 'border-green-700 bg-green-900/20' : 'border-green-200 bg-green-50')
                  : sessionResult.curpMatch === false
                  ? (isDark ? 'border-red-700 bg-red-900/20' : 'border-red-200 bg-red-50')
                  : (isDark ? 'border-amber-700 bg-amber-900/20' : 'border-amber-200 bg-amber-50')
              }`}>
                <div className="flex items-center gap-2">
                  {sessionResult.curpMatch === true ? (
                    <CheckCircle2 size={16} className={isDark ? 'text-green-400' : 'text-green-600'} />
                  ) : sessionResult.curpMatch === false ? (
                    <AlertTriangle size={16} className={isDark ? 'text-red-400' : 'text-red-500'} />
                  ) : (
                    <Shield size={16} className={isDark ? 'text-amber-400' : 'text-amber-500'} />
                  )}
                  <p className={`text-xs font-semibold ${
                    sessionResult.curpMatch === true
                      ? (isDark ? 'text-green-300' : 'text-green-700')
                      : sessionResult.curpMatch === false
                      ? (isDark ? 'text-red-300' : 'text-red-700')
                      : (isDark ? 'text-amber-300' : 'text-amber-700')
                  }`}>
                    {sessionResult.curpMatch === true
                      ? '✅ Identidad confirmada — CURP coincide'
                      : sessionResult.curpMatch === false
                      ? '❌ Advertencia — CURP no coincide' :'⚠️ CURP extraída — Sin perfil para comparar'}
                  </p>
                </div>
                {sessionResult.curpExtracted && (
                  <div className={`flex justify-between text-xs border-t pt-1.5 ${
                    sessionResult.curpMatch === true
                      ? (isDark ? 'border-green-700 text-green-400' : 'border-green-200 text-green-600')
                      : sessionResult.curpMatch === false
                      ? (isDark ? 'border-red-700 text-red-400' : 'border-red-200 text-red-600')
                      : (isDark ? 'border-amber-700 text-amber-400' : 'border-amber-200 text-amber-600')
                  }`}>
                    <span>CURP en identificación</span>
                    <span className="font-mono font-semibold">{sessionResult.curpExtracted}</span>
                  </div>
                )}
                {sessionResult.curpProfile && (
                  <div className={`flex justify-between text-xs border-t pt-1.5 ${
                    sessionResult.curpMatch === true
                      ? (isDark ? 'border-green-700 text-green-400' : 'border-green-200 text-green-600')
                      : sessionResult.curpMatch === false
                      ? (isDark ? 'border-red-700 text-red-400' : 'border-red-200 text-red-600')
                      : (isDark ? 'border-amber-700 text-amber-400' : 'border-amber-200 text-amber-600')
                  }`}>
                    <span>CURP en perfil</span>
                    <span className="font-mono font-semibold">{sessionResult.curpProfile}</span>
                  </div>
                )}
              </div>
            )}

            {/* Continue button */}
            <button
              type="button"
              onClick={handleProceedFromResult}
              disabled={
                sessionResult.identityFailed ||
                (sessionResult.nubariumSimilitud !== null && sessionResult.nubariumSimilitud < 99)
              }
              className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors ${
                sessionResult.identityFailed ||
                (sessionResult.nubariumSimilitud !== null && sessionResult.nubariumSimilitud < 99)
                  ? 'bg-primary/40 cursor-not-allowed' :'bg-primary hover:bg-primary/90'
              }`}
            >
              <ChevronRight size={15} />
              Continuar con el proceso de firma
            </button>
          </div>
        )}

        {status === 'completed' && (
          <div className="flex flex-col items-center gap-2 py-4">
            <CheckCircle2 size={24} className="text-green-500" />
            <p className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-slate-700'}`}>Identificación y selfie recibidas correctamente</p>
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-2 py-4">
            <AlertTriangle size={22} className="text-amber-500" />
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>No se pudo generar el QR. Continúa sin prueba de vida.</p>
          </div>
        )}
        {status !== 'result' && (
          <button
            type="button"
            onClick={onSkip}
            className={`w-full text-xs py-2 transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Omitir prueba de vida
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Camera Biometric Modal (same device) ────────────────────────────────────
function CameraBiometricModal({
  isDark,
  onSkip,
  onCapture,
  hasStoredId = false,
  userId,
}: {
  isDark: boolean;
  onSkip: () => void;
  onCapture: (selfieB64: string, ineB64: string | null, method: string) => void;
  hasStoredId?: boolean;
  userId?: string;
}) {
  const [step, setStep] = useState<'selfie' | 'ine' | 'comparing' | 'result'>('selfie');
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null);
  const [capturedSelfie, setCapturedSelfie] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ovalRef = useRef<HTMLDivElement>(null);

  // Result state (for hasStoredId mode)
  const [comparisonResult, setComparisonResult] = useState<{
    similitud: number | null;
    aprobado: boolean;
    curpMatch: boolean | null;
    curpExtracted: string | null;
    curpProfile: string | null;
    error: string | null;
  } | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  };

  const startCamera = async (facingMode: 'user' | 'environment') => {
    stopStream();
    setCameraReady(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') setCameraError('Permiso denegado. Continúa sin prueba de vida.');
      else if (err.name === 'NotFoundError') setCameraError('No se detectó cámara. Continúa sin prueba de vida.');
      else setCameraError('Cámara en uso. Continúa sin prueba de vida.');
    }
  };

  useEffect(() => {
    if (step === 'selfie') startCamera('user');
    if (step === 'ine') startCamera('environment');
    return stopStream;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const capturePhotoFromVideo = (): string | null => {
    const video = videoRef.current;
    if (!video) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;

    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Mirror horizontally for front camera (selfie)
    if (step === 'selfie' || hasStoredId) {
      ctx.translate(vw, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, vw, vh);
    return canvas.toDataURL('image/jpeg', 0.92);
  };

  const handleCaptureSelfie = () => {
    const dataUrl = capturePhotoFromVideo();
    if (!dataUrl) return;
    setCapturedSelfie(dataUrl);
    stopStream();
  };

  const handleRetakeSelfie = () => {
    setCapturedSelfie(null);
    setComparisonResult(null);
    startCamera('user');
  };

  const handleUseSelfie = async () => {
    if (!capturedSelfie) return;

    if (!hasStoredId) {
      // Legacy flow: go to INE step
      setSelfieDataUrl(capturedSelfie);
      setStep('ine');
      return;
    }

    // hasStoredId mode: fetch stored ID and compare with Nubarium
    setStep('comparing');

    try {
      const supabase = createClient();

      // Fetch stored ID (anverso_b64) from id_capture_logs
      const { data: idLog } = await supabase
        .from('id_capture_logs')
        .select('anverso_b64, curp_extracted, user_id')
        .eq('user_id', userId || '')
        .not('anverso_b64', 'is', null)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Also fetch user profile CURP for comparison
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('curp')
        .eq('id', userId || '')
        .maybeSingle();

      const profileCurp = profile?.curp || null;
      const extractedCurp = idLog?.curp_extracted || null;

      let similitud: number | null = null;
      let aprobado = false;
      let compError: string | null = null;

      if (idLog?.anverso_b64) {
        // Call Nubarium facial comparison
        const res = await fetch('/api/nubarium/reconocimiento-facial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credencial: idLog.anverso_b64,
            captura: capturedSelfie,
          }),
        });
        const data = await res.json();
        similitud = typeof data.similitud === 'number' ? data.similitud : null;
        aprobado = data.aprobado === true && similitud !== null && similitud >= 99.50;
        if (!res.ok || data.error) {
          compError = data.error || 'Error al comparar rostros';
        }
      } else {
        compError = 'No se encontró identificación almacenada para comparar.';
      }

      // CURP comparison
      let curpMatch: boolean | null = null;
      if (extractedCurp && profileCurp) {
        curpMatch = extractedCurp.trim().toUpperCase() === profileCurp.trim().toUpperCase();
      }

      setComparisonResult({
        similitud,
        aprobado,
        curpMatch,
        curpExtracted: extractedCurp,
        curpProfile: profileCurp,
        error: compError,
      });
      setStep('result');
    } catch (err: any) {
      setComparisonResult({
        similitud: null,
        aprobado: false,
        curpMatch: null,
        curpExtracted: null,
        curpProfile: null,
        error: err?.message || 'Error inesperado al comparar identidad.',
      });
      setStep('result');
    }
  };

  const handleProceedFromResult = () => {
    if (!capturedSelfie) return;
    onCapture(capturedSelfie, null, 'selfie_same_device');
  };

  if (cameraError) {
    return (
      <div className={`rounded-xl border p-5 text-center space-y-3 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <AlertTriangle size={28} className="text-amber-500 mx-auto" />
        <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>{cameraError}</p>
        <button type="button" onClick={onSkip} className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90">
          Continuar sin prueba de vida
        </button>
      </div>
    );
  }

  // ── Comparing state ──────────────────────────────────────────────────────
  if (step === 'comparing') {
    return (
      <div className={`rounded-xl border p-6 flex flex-col items-center gap-3 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <Loader2 size={28} className="animate-spin text-primary" />
        <p className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>Comparando identidad facial…</p>
        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>Validando con Nubarium y verificando CURP</p>
      </div>
    );
  }

  // ── Result state (hasStoredId mode) ──────────────────────────────────────
  if (step === 'result' && comparisonResult) {
    const { similitud, aprobado, curpMatch, curpExtracted, curpProfile, error } = comparisonResult;
    const hasError = !!error && similitud === null;
    const belowThreshold = !hasError && !aprobado;

    return (
      <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <div className={`px-4 py-3 border-b flex items-center gap-2 ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
          <Camera size={15} className="text-primary" />
          <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>Resultado de prueba de vida</p>
        </div>
        <div className="p-4 space-y-3">
          {/* Selfie preview */}
          {capturedSelfie && (
            <div className="flex justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capturedSelfie} alt="Selfie capturada" className="w-24 h-24 rounded-full object-cover border-2 border-slate-200" />
            </div>
          )}

          {/* Face match result */}
          {!hasError && (
            <div className={`rounded-lg p-3 flex items-start gap-2 ${aprobado ? (isDark ? 'bg-green-900/20 border border-green-700' : 'bg-green-50 border border-green-200') : (isDark ? 'bg-amber-900/20 border border-amber-700' : 'bg-amber-50 border border-amber-200')}`}>
              {aprobado
                ? <CheckCircle2 size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
                : <AlertTriangle size={15} className="text-amber-500 flex-shrink-0 mt-0.5" />
              }
              <div>
                <p className={`text-xs font-semibold ${aprobado ? (isDark ? 'text-green-400' : 'text-green-700') : (isDark ? 'text-amber-400' : 'text-amber-700')}`}>
                  {aprobado ? 'Identidad facial verificada' : 'Similitud facial insuficiente'}
                </p>
                {similitud !== null && (
                  <p className={`text-[11px] mt-0.5 ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                    Similitud: <span className="font-semibold">{similitud.toFixed(1)}%</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Below-threshold warning — must retry */}
          {belowThreshold && (
            <div className={`rounded-lg p-3 flex items-start gap-2 ${isDark ? 'bg-red-900/20 border border-red-700' : 'bg-red-50 border border-red-200'}`}>
              <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-700'}`}>
                El porcentaje de similitud no alcanzó el mínimo requerido. Por favor repite la captura asegurándote de tener buena iluminación y el rostro bien centrado.
              </p>
            </div>
          )}

          {/* Error state */}
          {hasError && (
            <div className={`rounded-lg p-3 flex items-start gap-2 ${isDark ? 'bg-red-900/20 border border-red-700' : 'bg-red-50 border border-red-200'}`}>
              <AlertTriangle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className={`text-xs ${isDark ? 'text-red-400' : 'text-red-700'}`}>{error}</p>
            </div>
          )}

          {/* CURP comparison */}
          {(curpExtracted || curpProfile) && (
            <div className={`rounded-lg border overflow-hidden text-xs ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
              <div className={`px-3 py-1.5 font-semibold uppercase tracking-wide text-[10px] ${isDark ? 'bg-gray-700 text-gray-300' : 'bg-slate-100 text-slate-600'}`}>
                Comparación de CURP
              </div>
              {curpExtracted && (
                <div className={`flex justify-between items-center px-3 py-2 border-b ${isDark ? 'border-gray-700 text-gray-300' : 'border-slate-100 text-slate-600'}`}>
                  <span>CURP en identificación</span>
                  <span className="font-mono font-semibold">{curpExtracted}</span>
                </div>
              )}
              {curpProfile && (
                <div className={`flex justify-between items-center px-3 py-2 ${
                  curpMatch === true
                    ? (isDark ? 'text-green-400' : 'text-green-700')
                    : curpMatch === false
                    ? (isDark ? 'text-red-400' : 'text-red-700')
                    : (isDark ? 'text-gray-300' : 'text-slate-600')
                }`}>
                  <span>CURP en perfil</span>
                  <span className="font-mono font-semibold">{curpProfile}</span>
                </div>
              )}
              {curpMatch !== null && (
                <div className={`px-3 py-1.5 text-[10px] font-semibold ${curpMatch ? (isDark ? 'bg-green-900/20 text-green-400' : 'bg-green-50 text-green-700') : (isDark ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-700')}`}>
                  {curpMatch ? '✅ CURP coincide con el perfil registrado' : '⚠️ CURP no coincide con el perfil registrado'}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRetakeSelfie}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm border rounded-xl transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <RefreshCw size={13} />
              Repetir
            </button>
            <button
              type="button"
              onClick={handleProceedFromResult}
              disabled={belowThreshold || hasError}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors ${
                belowThreshold || hasError
                  ? 'bg-primary/40 cursor-not-allowed' :'bg-primary hover:bg-primary/90'
              }`}
            >
              <ChevronRight size={14} />
              Continuar
            </button>
          </div>
          <button
            type="button"
            onClick={onSkip}
            className={`w-full text-xs py-1.5 transition-colors ${isDark ? 'text-gray-500 hover:text-gray-300' : 'text-slate-400 hover:text-slate-600'}`}
          >
            Omitir prueba de vida
          </button>
        </div>
      </div>
    );
  }

  // ── Selfie capture (hasStoredId mode — oval guide) ───────────────────────
  if (hasStoredId) {
    return (
      <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
          <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>📷 Captura tu selfie (prueba de vida)</p>
        </div>
        <div className="p-4 space-y-3">
          {capturedSelfie ? (
            // Preview captured selfie
            <div className="space-y-3">
              <div className="relative rounded-lg overflow-hidden bg-black flex items-center justify-center" style={{ aspectRatio: '3/4', maxHeight: 420 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={capturedSelfie} alt="Selfie capturada" className="w-full h-full object-cover" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div
                    ref={ovalRef}
                    className="border-2 border-white/70"
                    style={{ width: '72%', aspectRatio: '3/4', borderRadius: '50%' }}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRetakeSelfie}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm border rounded-xl transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                >
                  <RefreshCw size={13} />
                  Repetir
                </button>
                <button
                  type="button"
                  onClick={handleUseSelfie}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
                >
                  <Check size={14} />
                  Usar foto — Continuar
                </button>
              </div>
            </div>
          ) : (
            // Live camera with oval guide
            <div className="space-y-3">
              <div className="relative rounded-lg overflow-hidden bg-black" style={{ aspectRatio: '3/4', maxHeight: 420 }}>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" style={{ transform: 'scaleX(-1)' }} />
                {/* Oval guide overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div
                    ref={ovalRef}
                    className="border-[3px] border-white"
                    style={{
                      width: '72%',
                      aspectRatio: '3/4',
                      borderRadius: '50%',
                      boxShadow: '0 0 0 9999px rgba(0,0,0,0.50)',
                    }}
                  />
                </div>
                {!cameraReady && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                    <Loader2 size={24} className="animate-spin text-white/70" />
                  </div>
                )}
              </div>
              <p className={`text-xs text-center ${isDark ? 'text-gray-400' : 'text-slate-500'}`}>
                Centra tu rostro dentro del óvalo y captura la selfie
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCaptureSelfie}
                  disabled={!cameraReady}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Camera size={14} />
                  Capturar selfie
                </button>
                <button
                  type="button"
                  onClick={() => { stopStream(); onSkip(); }}
                  className={`px-3 py-2.5 text-sm border rounded-xl transition-colors ${isDark ? 'border-gray-600 text-gray-400 hover:bg-gray-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  Omitir
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Legacy flow (no stored ID): selfie + INE ─────────────────────────────
  return (
    <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
      <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
        <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>
          {step === 'selfie' ? '📷 Captura tu selfie (prueba de vida)' : '🪪 Captura tu INE'}
        </p>
      </div>
      <div className="p-4 space-y-3">
        <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
          {step === 'selfie' ? (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-40 h-40 rounded-full border-2 border-white/60" />
            </div>
          ) : (
            <div className="absolute inset-4 border-2 border-white/60 rounded-lg flex items-end justify-center pb-2 pointer-events-none">
              <span className="text-white text-xs bg-black/50 px-2 py-1 rounded">Coloca tu INE dentro del recuadro</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const dataUrl = capturePhotoFromVideo();
              if (!dataUrl) return;
              if (step === 'selfie') {
                setSelfieDataUrl(dataUrl);
                stopStream();
                setStep('ine');
              } else {
                stopStream();
                onCapture(selfieDataUrl!, dataUrl, 'selfie_ine');
              }
            }}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
          >
            <Camera size={14} />
            {step === 'selfie' ? 'Capturar selfie' : 'Capturar INE'}
          </button>
          <button
            type="button"
            onClick={() => { stopStream(); onSkip(); }}
            className={`px-3 py-2.5 text-sm border rounded-xl transition-colors ${isDark ? 'border-gray-600 text-gray-400 hover:bg-gray-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >
            Omitir
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main AutographSignatureFlow Component ────────────────────────────────────
export default function AutographSignatureFlow({ documentId, userId, userToken, userEmail, userName, documentName, isDark, onComplete, onNoticeAccepted }: Props) {
  // Flow steps: notice → pad → biometric → biometric_device → otp → sending → constancia
  const [flowStep, setFlowStep] = useState<'notice' | 'pad' | 'biometric' | 'biometric_camera' | 'biometric_qr' | 'otp' | 'sending' | 'constancia'>('notice');

  // Evidence collection
  const [sessionEvidence, setSessionEvidence] = useState<SessionEvidence | null>(null);
  const [deviceFingerprint, setDeviceFingerprint] = useState<DeviceFingerprint | null>(null);

  // Signature pad
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<any>(null);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [padReady, setPadReady] = useState(false);
  const [penColor, setPenColor] = useState<string>('#0a0a0f');
  const [strokeSize, setStrokeSize] = useState<'thin' | 'medium' | 'thick'>('medium');

  // ── Persisted signature data (survives pad unmount) ────────────────────────
  const [savedSignatureDataUrl, setSavedSignatureDataUrl] = useState<string | null>(null);
  const [savedSignatureStrokes, setSavedSignatureStrokes] = useState<any[] | null>(null);

  // Frames
  const framesRef = useRef<{ frame1?: FrameCapture; frame2?: FrameCapture; frame3?: FrameCapture; strokeStartCaptured: boolean }>({ strokeStartCaptured: false });

  // Biometric
  const [biometricData, setBiometricData] = useState<{ selfieB64: string; ineB64: string | null; method: string; mobileMetadata?: any } | null>(null);
  const [enrollmentHasIne, setEnrollmentHasIne] = useState(false);

  // OTP
  const [otpCode, setOtpCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState<Date | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpTimeLeft, setOtpTimeLeft] = useState<number>(0);
  const [otpVerified, setOtpVerified] = useState(false);

  // Results
  const [constanciaData, setConstanciaData] = useState<ConstanciaData | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Persist state
  const [persistedEvidenceId, setPersistedEvidenceId] = useState<string | null>(null);
  const [persistedCapturedAt, setPersistedCapturedAt] = useState<string | null>(null);

  // Geolocation denied state
  const [geoDenied, setGeoDenied] = useState(false);

  // ── Collect session evidence on mount ──────────────────────────────────────
  useEffect(() => {
    const collect = async () => {
      const rawGeo = await new Promise<{ latitude: number; longitude: number; accuracy_meters: number; source: string } | null>((resolve) => {
        if (!navigator.geolocation) { setGeoDenied(true); return resolve(null); }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy_meters: pos.coords.accuracy, source: 'browser_api' }),
          (err) => {
            if (err.code === 1 /* PERMISSION_DENIED */) setGeoDenied(true);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });

      // Enrich geo with reverse geocoding via get-location edge function
      let geo: SessionEvidence['geo'] = rawGeo;
      if (rawGeo) {
        try {
          const supabase = createClient();
          const { data: locationData, error: locationError } = await supabase.functions.invoke('get-location', {
            body: { lat: rawGeo.latitude, lon: rawGeo.longitude },
          });
          if (!locationError && locationData) {
            geo = {
              ...rawGeo,
              country: locationData.country ?? undefined,
              country_code: locationData.country_code ?? undefined,
              region: locationData.state ?? undefined,
              city: locationData.city ?? undefined,
              formatted: locationData.formatted ?? undefined,
            };
          }
        } catch {
          // Reverse geocoding failed — continue with raw geo, don't block signing
        }
      }

      setSessionEvidence({
        user_agent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        touch_points: navigator.maxTouchPoints,
        geo,
      });

      try {
        const FingerprintJS = (await import('@fingerprintjs/fingerprintjs')).default;
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        const components = result.components as any;
        const fpData = {
          visitor_id: result.visitorId,
          canvas_hash: components?.canvas?.value ?? undefined,
          webgl_vendor: components?.webglVendor?.value ?? undefined,
          webgl_renderer: components?.webgl?.value ?? undefined,
          audio_hash: components?.audio?.value ?? undefined,
          screen_resolution: `${screen.width}x${screen.height}x${screen.colorDepth}`,
          language: navigator.language,
          cpu_cores: navigator.hardwareConcurrency,
          device_memory_gb: (navigator as any).deviceMemory ?? undefined,
          touch_points: navigator.maxTouchPoints,
          platform: navigator.platform,
          plugins_count: navigator.plugins?.length ?? 0,
        };
        const fingerprintId = await sha256(JSON.stringify(fpData));
        setDeviceFingerprint({ ...fpData, fingerprint_id: fingerprintId });
      } catch { /* fingerprint optional */ }
    };
    collect();
  }, []);

  // ── OTP countdown ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!otpExpiresAt) return;
    const interval = setInterval(() => {
      const left = Math.max(0, Math.floor((otpExpiresAt.getTime() - Date.now()) / 1000));
      setOtpTimeLeft(left);
      if (left === 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [otpExpiresAt]);

  // ── Resize canvas to match displayed size (fixes cursor offset) ───────────
  useEffect(() => {
    if (flowStep !== 'pad') return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const ratio = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      // Save current drawing
      const data = padRef.current?.toData?.() ?? [];
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(ratio, ratio);
      // Restore drawing after resize
      if (padRef.current && data.length) {
        padRef.current.fromData(data);
      }
    };

    const observer = new ResizeObserver(() => resizeCanvas());
    observer.observe(canvas);
    // Initial resize after layout
    requestAnimationFrame(resizeCanvas);

    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStep]);

  // ── Init signature_pad ─────────────────────────────────────────────────────
  useEffect(() => {
    if (flowStep !== 'pad') return;
    let pad: any = null;
    const initPad = async () => {
      const SignaturePad = (await import('signature_pad')).default;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const strokeMap = { thin: { minWidth: 0.4, maxWidth: 1.2 }, medium: { minWidth: 0.8, maxWidth: 2.8 }, thick: { minWidth: 2.0, maxWidth: 5.0 } };
      const { minWidth: minW, maxWidth: maxW } = strokeMap[strokeSize];
      pad = new SignaturePad(canvas, { minWidth: minW, maxWidth: maxW, penColor: penColor, throttle: 16 });
      padRef.current = pad;
      setPadReady(true);

      pad.addEventListener('beginStroke', async () => {
        setHasStrokes(true);
        if (!framesRef.current.strokeStartCaptured) {
          framesRef.current.strokeStartCaptured = true;
          framesRef.current.frame1 = await captureFrame('stroke_start');
        }
      });

      pad.addEventListener('endStroke', async () => {
        framesRef.current.frame2 = await captureFrame('stroke_end');
      });
    };
    initPad();
    return () => { pad?.off(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStep, penColor, strokeSize]);

  // ── Update pad color/stroke when settings change ───────────────────────────
  useEffect(() => {
    if (!padRef.current || flowStep !== 'pad') return;
    const strokeMap = { thin: { minWidth: 0.4, maxWidth: 1.2 }, medium: { minWidth: 0.8, maxWidth: 2.8 }, thick: { minWidth: 2.0, maxWidth: 5.0 } };
    const { minWidth: minW, maxWidth: maxW } = strokeMap[strokeSize];
    padRef.current.penColor = penColor;
    padRef.current.minWidth = minW;
    padRef.current.maxWidth = maxW;
  }, [penColor, strokeSize, flowStep]);

  // ── Capture frame ──────────────────────────────────────────────────────────
  const captureFrame = useCallback(async (event: string): Promise<FrameCapture> => {
    try {
      const html2canvas = (await import('html2canvas')).default;
      const element = document.getElementById('signing-container') || document.body;
      const canvas = await html2canvas(element, {
        scale: 0.60, useCORS: true, backgroundColor: '#ffffff', logging: false,
        ignoreElements: (el: Element) => el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password',
      });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      const hashVal = await sha256(dataUrl);
      return {
        frame_id: crypto.randomUUID(),
        event,
        timestamp: new Date().toISOString(),
        sha256: hashVal,
        size_bytes: Math.round(dataUrl.length * 0.75),
        width: canvas.width,
        height: canvas.height,
        dataUrl,
      };
    } catch {
      const fallback = `fallback-${event}-${Date.now()}`;
      return { frame_id: crypto.randomUUID(), event, timestamp: new Date().toISOString(), sha256: await sha256(fallback), size_bytes: 0, width: 0, height: 0, dataUrl: '' };
    }
  }, []);

  // ── Handle pad confirm ─────────────────────────────────────────────────────
  const handlePadConfirm = () => {
    if (!padRef.current || padRef.current.isEmpty()) return;
    // Save signature data before unmounting the pad
    setSavedSignatureDataUrl(padRef.current.toDataURL('image/png'));
    setSavedSignatureStrokes(padRef.current.toData());
    setFlowStep('biometric');
  };

  const handlePadClear = () => {
    padRef.current?.clear();
    setHasStrokes(false);
    framesRef.current = { strokeStartCaptured: false };
  };

  // ── Handle biometric ───────────────────────────────────────────────────────
  const handleBiometricCapture = async (selfieB64: string, ineB64: string | null, method: string, mobileMetadata?: any) => {
    const bioData = { selfieB64, ineB64, method, mobileMetadata: mobileMetadata ?? null };
    setBiometricData(bioData);

    // When coming from mobile QR biometric, identity has already been verified
    // on the mobile device — skip OTP and proceed directly to sending
    if (method === 'mobile_id_capture') {
      setOtpVerified(true);
      setFlowStep('sending');
      setSendError(null);
      framesRef.current.frame3 = await captureFrame('confirmation');
      await sendAll(bioData);
      return;
    }

    // When coming from same-device biometric (Este equipo), biometric validation
    // already passed the 99.50% threshold — skip OTP and proceed directly to sending
    if (method === 'selfie_same_device') {
      setOtpVerified(true);
      setFlowStep('sending');
      setSendError(null);
      framesRef.current.frame3 = await captureFrame('confirmation');
      await sendAll(bioData);
      return;
    }

    sendOtp();
    setFlowStep('otp');
  };

  const handleBiometricSkip = () => {
    setBiometricData(null);
    sendOtp();
    setFlowStep('otp');
  };

  const handleBiometricDeviceChoice = (mode: 'same_device' | 'mobile', hasIne: boolean) => {
    setEnrollmentHasIne(hasIne);
    if (mode === 'same_device') {
      setFlowStep('biometric_camera');
    } else {
      setFlowStep('biometric_qr');
    }
  };

  // ── Send OTP ───────────────────────────────────────────────────────────────
  const sendOtp = async () => {
    if (!userEmail) return;
    setOtpSending(true);
    setOtpError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || userToken;

      const res = await fetch('/api/firma/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          documentId,
          documentName: documentName || 'Documento',
          recipientEmail: userEmail,
          recipientName: userName || userEmail,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setOtpSent(true);
        setOtpExpiresAt(new Date(data.expiresAt));
        setOtpTimeLeft(data.expiryMinutes * 60);
      } else {
        setOtpError(data.error || 'Error al enviar OTP');
      }
    } catch {
      setOtpError('Error al enviar el código OTP');
    } finally {
      setOtpSending(false);
    }
  };

  // ── Handle OTP confirm ─────────────────────────────────────────────────────
  const handleOtpConfirm = async () => {
    setOtpError(null);

    // Validate against backend before proceeding
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || userToken;

      const res = await fetch('/api/firma/send-otp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ documentId, otpCode: otpCode.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setOtpError(data.error || 'Código OTP inválido');
        return;
      }

      setOtpVerified(true);
    } catch {
      setOtpError('Error al verificar el código OTP');
      return;
    }

    setFlowStep('sending');
    setSendError(null);
    framesRef.current.frame3 = await captureFrame('confirmation');
    await sendAll();
  };

  // ── Send all to backend ────────────────────────────────────────────────────
  const sendAll = async (biometricOverride?: { selfieB64: string; ineB64: string | null; method: string; mobileMetadata?: any } | null) => {
    try {
      // Use live pad if available, otherwise fall back to saved data
      let imageDataUrl: string;
      let rawStrokes: any[];

      if (padRef.current && !padRef.current.isEmpty()) {
        imageDataUrl = padRef.current.toDataURL('image/png');
        rawStrokes = padRef.current.toData();
      } else if (savedSignatureDataUrl && savedSignatureStrokes) {
        imageDataUrl = savedSignatureDataUrl;
        rawStrokes = savedSignatureStrokes;
      } else {
        throw new Error('No hay datos de firma disponibles');
      }

      const enrichedStrokes = rawStrokes.map((stroke: any, strokeIdx: number) => ({
        stroke_index: strokeIdx,
        duration_ms: stroke.points.length > 1 ? stroke.points[stroke.points.length - 1].time - stroke.points[0].time : 0,
        points: stroke.points.map((pt: any, i: number, arr: any[]) => {
          const prev = arr[i - 1] || pt;
          const dt = (pt.time - prev.time) / 1000 || 0.001;
          return { x: pt.x, y: pt.y, t: pt.time - arr[0].time, pressure: pt.pressure || 1.0, vx: (pt.x - prev.x) / dt, vy: (pt.y - prev.y) / dt };
        }),
      }));

      const behavior = analyzeHumanBehavior(enrichedStrokes);

      const imageBytes = await fetch(imageDataUrl).then(r => r.arrayBuffer());
      const imageHash = await sha256Bytes(imageBytes);
      const strokesHash = await sha256(JSON.stringify(enrichedStrokes));
      const combinedHash = await sha256(imageHash + strokesHash);

      const frames = [framesRef.current.frame1, framesRef.current.frame2, framesRef.current.frame3].filter(Boolean) as FrameCapture[];
      const chainHash = frames.length === 3 ? await sha256(frames.map(f => f.sha256).join('|')) : '';

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || userToken;
      const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

      // 1. capture-signature
      const sigRes = await fetch(`${supabaseUrl}/functions/v1/capture-signature`, {
        method: 'POST', headers,
        body: JSON.stringify({
          document_id: documentId,
          image_b64: imageDataUrl,
          strokes: enrichedStrokes,
          image_sha256: imageHash,
          strokes_sha256: strokesHash,
          combined_sha256: combinedHash,
          human_score: behavior.human_score,
          anomaly_flags: behavior.anomaly_flags,
          avg_pressure: behavior.avg_pressure,
          total_strokes: behavior.total_strokes,
          total_duration_ms: behavior.total_duration_ms,
          device_fingerprint: deviceFingerprint,
          session_evidence: sessionEvidence,
        }),
      });

      if (!sigRes.ok) {
        const err = await sigRes.json().catch(() => ({}));
        throw new Error(err.error || 'Error al capturar firma');
      }
      const sigData = await sigRes.json();

      // 2. upload-session-frames
      if (frames.length === 3) {
        const manifest = {
          document_id: documentId,
          total_frames: 3,
          chain_hash: chainHash,
          frames: frames.map(f => ({ frame_id: f.frame_id, event: f.event, timestamp: f.timestamp, sha256: f.sha256, size_bytes: f.size_bytes })),
        };
        const images = frames.map(f => ({ frame_id: f.frame_id, image_b64: f.dataUrl }));
        await fetch(`${supabaseUrl}/functions/v1/upload-session-frames`, {
          method: 'POST', headers,
          body: JSON.stringify({ manifest, images }),
        }).catch(() => {});
      }

      // 3. capture-biometric (optional)
      let biometricResult: ConstanciaData['biometric'] | undefined;
      const activeBiometric = biometricOverride !== undefined ? biometricOverride : biometricData;
      if (activeBiometric) {
        const bioRes = await fetch(`${supabaseUrl}/functions/v1/capture-biometric`, {
          method: 'POST', headers,
          body: JSON.stringify({
            document_id: documentId,
            selfie_b64: activeBiometric.selfieB64,
            ine_front_b64: activeBiometric.ineB64,
            method: activeBiometric.method,
          }),
        }).catch(() => null);
        if (bioRes?.ok) {
          const bioData = await bioRes.json();
          biometricResult = {
            selfie_sha256: bioData.selfie_sha256,
            face_match_score: bioData.face_match_score,
            face_match_verdict: bioData.face_match_verdict,
            method: activeBiometric.method,
          };
        }
      }

      const capturedAtVal = sigData.captured_at || new Date().toISOString();
      const evidenceIdVal = sigData.evidence_id || '';

      // 4. Persist complete evidence to document via our API
      const persistRes = await fetch('/api/firma/persist-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          documentId,
          documentName: documentName || 'Documento',
          userName: userName || userEmail || '',
          userEmail: userEmail || '',
          evidenceId: evidenceIdVal,
          imageSha256: imageHash,
          strokesSha256: strokesHash,
          combinedSha256: combinedHash,
          totalStrokes: behavior.total_strokes,
          totalDurationMs: behavior.total_duration_ms,
          humanScore: behavior.human_score,
          anomalyFlags: behavior.anomaly_flags,
          avgPressure: behavior.avg_pressure,
          capturedAt: capturedAtVal,
          ipAddress: sigData.ip_address || '',
          fingerprintId: deviceFingerprint?.fingerprint_id || '',
          chainHash,
          otpVerified: otpVerified,
          biometric: biometricResult,
          sessionEvidence,
          deviceFingerprint,
          humanBehavior: {
            total_points: behavior.total_points,
            avg_speed_px_s: behavior.avg_speed_px_s,
            max_speed_px_s: behavior.max_speed_px_s,
          },
          clientTimestamp: new Date().toISOString(),
        }),
      }).catch(() => null);

      let finalEvidenceId = evidenceIdVal;
      let finalCapturedAt = capturedAtVal;

      if (persistRes?.ok) {
        const persistData = await persistRes.json().catch(() => ({}));
        finalEvidenceId = persistData.evidenceId || evidenceIdVal;
        finalCapturedAt = persistData.capturedAt || capturedAtVal;
      }

      setPersistedEvidenceId(finalEvidenceId);
      setPersistedCapturedAt(finalCapturedAt);

      setConstanciaData({
        evidence_id: finalEvidenceId,
        image_sha256: imageHash,
        strokes_sha256: strokesHash,
        combined_sha256: combinedHash,
        total_strokes: behavior.total_strokes,
        total_duration_ms: behavior.total_duration_ms,
        human_score: behavior.human_score,
        anomaly_flags: behavior.anomaly_flags,
        avg_pressure: behavior.avg_pressure,
        captured_at: finalCapturedAt,
        ip_address: sigData.ip_address || '—',
        fingerprint_id: deviceFingerprint?.fingerprint_id || '',
        frames,
        chain_hash: chainHash,
        otp_verified: otpVerified,
        biometric: biometricResult,
        geo: sessionEvidence?.geo ? { latitude: sessionEvidence.geo.latitude, longitude: sessionEvidence.geo.longitude } : null,
        signature_data_url: imageDataUrl,
        device_type: parseUserAgent(navigator.userAgent).deviceType,
        browser_name: parseUserAgent(navigator.userAgent).browserName,
        os_name: parseUserAgent(navigator.userAgent).osName,
      });

      setFlowStep('constancia');
      onComplete(imageDataUrl);
    } catch (err: any) {
      setSendError(err.message || 'Error al enviar la firma');
      setFlowStep('otp');
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  // Step: Notice
  if (flowStep === 'notice') {
    return (
      <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <div className={`px-4 py-3 border-b flex items-center gap-2 ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary flex-shrink-0"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>Iniciar proceso de obtención de firma</p>
        </div>
        <div className="p-4 space-y-3">
          <p className={`text-sm ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>
            Generamos automáticamente un registro del proceso para brindar plena validez legal a tu firma en el documento, por lo que se emitirá un registro de tiempo, dispositivo, ubicación y trazo de firma.
          </p>
          {geoDenied && (
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${isDark ? 'bg-amber-900/20 border-amber-700/50' : 'bg-amber-50 border-amber-200'}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 flex-shrink-0 mt-0.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <div>
                <p className={`text-xs font-semibold ${isDark ? 'text-amber-400' : 'text-amber-700'}`}>Acceso a ubicación bloqueado</p>
                <p className={`text-xs mt-0.5 leading-relaxed ${isDark ? 'text-amber-300/80' : 'text-amber-600'}`}>
                  Has bloqueado el acceso a tu ubicación. La firma se registrará sin coordenadas geográficas. Para incluir tu ubicación, activa el permiso en la configuración de tu navegador y recarga la página.
                </p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              onNoticeAccepted?.();
              setFlowStep('pad');
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-primary rounded-xl hover:bg-primary/90 transition-colors"
          >
            <Check size={14} />
            Entendido — Continuar
          </button>
        </div>
      </div>
    );
  }

  // Step: Pad
  if (flowStep === 'pad') {
    return (
      <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <div className={`px-4 py-2.5 border-b flex items-center justify-between ${isDark ? 'border-gray-700 bg-gray-750' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-center gap-2">
            <PenLine size={14} className="text-primary" />
            <p className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>Firma autógrafa digital — Dibujar</p>
          </div>
          {hasStrokes && <span className="text-xs text-green-600 font-medium">Trazo detectado</span>}
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-3">
            {/* Canvas */}
            <div
              className="relative border-2 border-dashed border-slate-300 rounded-xl bg-white overflow-hidden flex-1"
              style={{ touchAction: 'none' }}
            >
              <canvas
                ref={canvasRef}
                className="w-full cursor-crosshair block"
                style={{ height: '200px', touchAction: 'none' }}
              />
              {!hasStrokes && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center">
                    <PenLine size={28} className="text-slate-300 mx-auto mb-1" />
                    <p className="text-xs text-slate-400">Dibuja tu firma aquí</p>
                  </div>
                </div>
              )}
              <div className="absolute bottom-10 left-8 right-8 border-b border-slate-200 pointer-events-none" />
            </div>
            {/* Side controls */}
            <div className={`flex flex-col gap-3 py-1 px-2 rounded-xl border ${isDark ? 'border-gray-600 bg-gray-750' : 'border-slate-200 bg-slate-50'}`}>
              {/* Stroke thickness */}
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setStrokeSize('thin')}
                  title="Delgado"
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${strokeSize === 'thin' ? 'bg-primary/10 border-2 border-primary' : isDark ? 'border border-gray-600 hover:bg-gray-700' : 'border border-slate-200 hover:bg-slate-100'}`}
                >
                  <svg width="22" height="22" viewBox="0 0 22 22"><line x1="3" y1="11" x2="19" y2="11" stroke={isDark ? '#e2e8f0' : '#475569'} strokeWidth="1" strokeLinecap="round"/></svg>
                </button>
                <button
                  type="button"
                  onClick={() => setStrokeSize('medium')}
                  title="Medio"
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${strokeSize === 'medium' ? 'bg-primary/10 border-2 border-primary' : isDark ? 'border border-gray-600 hover:bg-gray-700' : 'border border-slate-200 hover:bg-slate-100'}`}
                >
                  <svg width="22" height="22" viewBox="0 0 22 22"><line x1="3" y1="11" x2="19" y2="11" stroke={isDark ? '#e2e8f0' : '#475569'} strokeWidth="2.5" strokeLinecap="round"/></svg>
                </button>
                <button
                  type="button"
                  onClick={() => setStrokeSize('thick')}
                  title="Grueso"
                  className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${strokeSize === 'thick' ? 'bg-primary/10 border-2 border-primary' : isDark ? 'border border-gray-600 hover:bg-gray-700' : 'border border-slate-200 hover:bg-slate-100'}`}
                >
                  <svg width="22" height="22" viewBox="0 0 22 22"><line x1="3" y1="11" x2="19" y2="11" stroke={isDark ? '#e2e8f0' : '#475569'} strokeWidth="5" strokeLinecap="round"/></svg>
                </button>
              </div>
              {/* Divider */}
              <div className={`w-full h-px ${isDark ? 'bg-gray-600' : 'bg-slate-200'}`} />
              {/* Color selector */}
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPenColor('#0a0a0f')}
                  title="Negro"
                  className={`w-7 h-7 rounded-full transition-all ${penColor === '#0a0a0f' ? 'ring-2 ring-offset-2 ring-slate-500 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: '#0a0a0f' }}
                />
                <button
                  type="button"
                  onClick={() => setPenColor('#1d4ed8')}
                  title="Azul"
                  className={`w-7 h-7 rounded-full transition-all ${penColor === '#1d4ed8' ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: '#1d4ed8' }}
                />
                <button
                  type="button"
                  onClick={() => setPenColor('#dc2626')}
                  title="Rojo"
                  className={`w-7 h-7 rounded-full transition-all ${penColor === '#dc2626' ? 'ring-2 ring-offset-2 ring-red-500 scale-110' : 'hover:scale-105'}`}
                  style={{ backgroundColor: '#dc2626' }}
                />
              </div>
            </div>
          </div>
          {!padReady && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" />
              Cargando pad de firma…
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handlePadClear}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border rounded-lg transition-colors ${isDark ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <RotateCcw size={13} />
              Limpiar
            </button>
            <button
              type="button"
              onClick={handlePadConfirm}
              disabled={!hasStrokes}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={13} />
              Confirmar firma
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Step: Biometric check
  if (flowStep === 'biometric') {
    return (
      <BiometricCheckModal
        isDark={isDark}
        userId={userId}
        onSkip={handleBiometricSkip}
        onProceedWithBiometric={handleBiometricDeviceChoice}
      />
    );
  }

  // Step: Biometric camera (same device)
  if (flowStep === 'biometric_camera') {
    return (
      <CameraBiometricModal
        isDark={isDark}
        onSkip={handleBiometricSkip}
        onCapture={handleBiometricCapture}
        hasStoredId={enrollmentHasIne}
        userId={userId}
      />
    );
  }

  // Step: Biometric QR (mobile)
  if (flowStep === 'biometric_qr') {
    return (
      <QRMobileBiometricModal
        isDark={isDark}
        documentId={documentId}
        userId={userId}
        hasEnrollment={enrollmentHasIne}
        onComplete={(selfieB64, method, metadata) => handleBiometricCapture(selfieB64, null, method, metadata)}
        onSkip={handleBiometricSkip}
      />
    );
  }

  // Step: OTP
  if (flowStep === 'otp') {
    const minutes = Math.floor(otpTimeLeft / 60);
    const seconds = otpTimeLeft % 60;
    return (
      <div className={`rounded-xl border overflow-hidden ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <div className={`px-4 py-3 border-b ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
          <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-slate-800'}`}>Verificación OTP — Confirmación de firma</p>
        </div>
        <div className="p-4 space-y-3">
          {otpSending && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={12} className="animate-spin" />
              Enviando código a tu correo…
            </div>
          )}
          {otpSent && !otpSending && (
            <div className={`rounded-lg p-3 flex items-start gap-2 ${isDark ? 'bg-blue-900/20 border border-blue-700' : 'bg-blue-50 border border-blue-200'}`}>
              <Check size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className={`text-xs font-medium ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                  Código enviado a {userEmail}
                </p>
                {otpTimeLeft > 0 && (
                  <p className={`text-[11px] mt-0.5 flex items-center gap-1 ${isDark ? 'text-blue-400' : 'text-blue-600'}`}>
                    <Clock size={10} />
                    Válido por {minutes}:{seconds.toString().padStart(2, '0')} minutos
                  </p>
                )}
                {otpTimeLeft === 0 && otpSent && (
                  <p className="text-[11px] mt-0.5 text-red-500">El código ha expirado.</p>
                )}
              </div>
            </div>
          )}
          {!otpSent && !otpSending && userEmail && (
            <button
              type="button"
              onClick={sendOtp}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 transition-colors"
            >
              Enviar código OTP a {userEmail}
            </button>
          )}
          {!userEmail && (
            <p className={`text-xs ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
              No se encontró correo electrónico. El código OTP no puede enviarse.
            </p>
          )}
          <input
            type="text"
            value={otpCode}
            onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').substring(0, 6))}
            placeholder="Ingresa el código de 6 dígitos"
            maxLength={6}
            className={`w-full px-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 text-center tracking-widest font-mono ${isDark ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-slate-200'}`}
          />
          {otpError && (
            <div className="flex items-center gap-2 text-xs text-red-500">
              <AlertTriangle size={12} />
              {otpError}
            </div>
          )}
          {sendError && (
            <div className="flex items-center gap-2 text-xs text-red-500">
              <AlertTriangle size={12} />
              {sendError}
            </div>
          )}
          {otpSent && otpTimeLeft === 0 && (
            <button
              type="button"
              onClick={sendOtp}
              className={`w-full text-xs py-1.5 flex items-center justify-center gap-1 ${isDark ? 'text-primary hover:text-primary/80' : 'text-primary hover:text-primary/80'}`}
            >
              <RefreshCw size={11} />
              Reenviar código
            </button>
          )}
          <button
            type="button"
            onClick={handleOtpConfirm}
            disabled={otpCode.trim().length < 4}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-green-500 rounded-xl hover:bg-green-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={14} />
            Verificar
          </button>
        </div>
      </div>
    );
  }

  // Step: Sending
  if (flowStep === 'sending') {
    return (
      <div className={`rounded-xl border p-6 flex flex-col items-center gap-3 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-slate-200 bg-white'}`}>
        <Loader2 size={28} className="animate-spin text-primary" />
        <p className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-slate-600'}`}>Enviando evidencia de firma…</p>
        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>Esto puede tomar unos segundos</p>
      </div>
    );
  }

  // Step: Constancia
  if (flowStep === 'constancia' && constanciaData) {
    return (
      <ConstanciaParticipacion
        isDark={isDark}
        documentName={documentName || 'Documento'}
        userName={userName || userEmail || 'Participante'}
        userEmail={userEmail || ''}
        capturedAt={persistedCapturedAt || constanciaData.captured_at}
        evidenceId={persistedEvidenceId || constanciaData.evidence_id}
        otpVerified={constanciaData.otp_verified}
        humanScore={constanciaData.human_score}
        hasBiometric={!!constanciaData.biometric}
        constanciaData={constanciaData}
        onClose={() => {
          // already called onComplete in sendAll
        }}
      />
    );
  }

  return null;
}
