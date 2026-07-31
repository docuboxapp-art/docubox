'use client';
import { useRef, useCallback } from 'react';

// ── SHA-256 helper ─────────────────────────────────────────────────────────────
async function sha256(data: string): Promise<string> {
  const buf = new TextEncoder().encode(data)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ── File to base64 ─────────────────────────────────────────────────────────────
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Types ──────────────────────────────────────────────────────────────────────
export interface FrameCapture {
  frame_id: string
  event: string
  timestamp: string
  sha256: string
  size_bytes: number
  width: number
  height: number
  dataUrl: string
}

export interface FramesManifest {
  document_id: string
  frames: Omit<FrameCapture, 'dataUrl'>[]
  images: { frame_id: string; image_b64: string }[]
  chain_hash: string
  total_frames: number
}

export interface DeviceFingerprint {
  visitor_id: string
  fingerprint_id: string
  screen_resolution: string
  language: string
  cpu_cores: number
  touch_points: number
  platform: string
  timezone: string
}

export interface SessionEvidence {
  user_agent: string
  language: string
  platform: string
  screen: string
  timezone: string
  touch_points: number
  geo: {
    latitude: number
    longitude: number
    accuracy_meters: number
    source: string
  } | null
}

export interface EfirmaEvidenceResult {
  deviceFingerprint: DeviceFingerprint
  sessionEvidence: SessionEvidence
  framesManifest: FramesManifest | null
}

// ── Hook ───────────────────────────────────────────────────────────────────────
export function useEfirmaEvidence(documentId: string) {
  const framesRef = useRef<FrameCapture[]>([])

  // Collect geolocation (non-blocking)
  const collectGeo = useCallback((): Promise<SessionEvidence['geo']> => {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null)
        return
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy_meters: pos.coords.accuracy,
            source: 'browser_api',
          }),
        () => resolve(null),
        { timeout: 5000 }
      )
    })
  }, [])

  // Collect device fingerprint
  const collectFingerprint = useCallback(async (): Promise<DeviceFingerprint> => {
    try {
      const FingerprintJS = await import('@fingerprintjs/fingerprintjs')
      const fp = await FingerprintJS.load()
      const result = await fp.get()

      const fingerprintData = {
        visitor_id: result.visitorId,
        screen_resolution: `${screen.width}x${screen.height}x${screen.colorDepth}`,
        language: navigator.language,
        cpu_cores: navigator.hardwareConcurrency || 0,
        touch_points: navigator.maxTouchPoints || 0,
        platform: navigator.platform || '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }

      const fingerprintId = await sha256(JSON.stringify(fingerprintData))

      return {
        ...fingerprintData,
        fingerprint_id: fingerprintId,
      }
    } catch {
      // Fallback fingerprint if FingerprintJS fails
      const fallback = {
        visitor_id: 'unknown',
        screen_resolution: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : 'unknown',
        language: typeof navigator !== 'undefined' ? navigator.language : 'unknown',
        cpu_cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 0 : 0,
        touch_points: typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
        platform: typeof navigator !== 'undefined' ? navigator.platform || '' : '',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
      const fingerprintId = await sha256(JSON.stringify(fallback))
      return { ...fallback, fingerprint_id: fingerprintId }
    }
  }, [])

  // Collect session evidence
  const collectSessionEvidence = useCallback(async (): Promise<SessionEvidence> => {
    const geo = await collectGeo()
    return {
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      language: typeof navigator !== 'undefined' ? navigator.language : '',
      platform: typeof navigator !== 'undefined' ? navigator.platform || '' : '',
      screen: typeof screen !== 'undefined'
        ? `${screen.width}x${screen.height}x${screen.colorDepth}`
        : 'unknown',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      touch_points: typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
      geo,
    }
  }, [collectGeo])

  // Capture a single frame
  const captureFrame = useCallback(async (
    event: string,
    containerId = 'signing-container'
  ): Promise<FrameCapture | null> => {
    try {
      const html2canvas = (await import('html2canvas')).default
      const element = document.getElementById(containerId)
      if (!element) return null

      const canvas = await html2canvas(element, {
        scale: 0.6,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        ignoreElements: (el) =>
          el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password',
      })

      const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
      const sha256Hash = await sha256(dataUrl)

      const frame: FrameCapture = {
        frame_id: crypto.randomUUID(),
        event,
        timestamp: new Date().toISOString(),
        sha256: sha256Hash,
        size_bytes: Math.round(dataUrl.length * 0.75),
        width: canvas.width,
        height: canvas.height,
        dataUrl,
      }

      framesRef.current.push(frame)
      return frame
    } catch {
      return null
    }
  }, [])

  // Build frames manifest from collected frames
  const buildFramesManifest = useCallback(async (): Promise<FramesManifest | null> => {
    const frames = framesRef.current
    if (frames.length === 0) return null

    const chainHash = await sha256(frames.map((f) => f.sha256).join('|'))

    return {
      document_id: documentId,
      frames: frames.map(({ dataUrl: _d, ...rest }) => rest),
      images: frames.map((f) => ({ frame_id: f.frame_id, image_b64: f.dataUrl })),
      chain_hash: chainHash,
      total_frames: frames.length,
    }
  }, [documentId])

  // Reset frames for a new session
  const resetFrames = useCallback(() => {
    framesRef.current = []
  }, [])

  // Collect all evidence at once
  const collectAllEvidence = useCallback(async (): Promise<{
    deviceFingerprint: DeviceFingerprint
    sessionEvidence: SessionEvidence
  }> => {
    const [deviceFingerprint, sessionEvidence] = await Promise.all([
      collectFingerprint(),
      collectSessionEvidence(),
    ])
    return { deviceFingerprint, sessionEvidence }
  }, [collectFingerprint, collectSessionEvidence])

  return {
    captureFrame,
    buildFramesManifest,
    resetFrames,
    collectAllEvidence,
    collectFingerprint,
    collectSessionEvidence,
  }
}
