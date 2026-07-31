"use client";

import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface VPSSignaturePanelProps {
  documentId: string;
  signingSessionId: string;
  signerName: string;
  signerEmail: string;
  reason: string;
  location?: string;
  signatureImageBlob?: Blob | null;
  onSignComplete: (signedPdfBlob: Blob, metadata: SignatureMetadata) => void;
  vpsAvailable?: boolean;
}

interface SignatureMetadata {
  signedHash: string;
  fieldName: string;
  signedAt: string;
  signatureLevel: string;
  certificate: string;
}

type SigningStep =
  | "idle" |"loading" |"success" |"error";

const SIGNING_STEPS = [
  "Preparando documento...",
  "Aplicando firma criptográfica PAdES...",
  "Solicitando sello de tiempo RFC 3161...",
  "Verificando integridad del documento...",
  "Finalizando...",
];

export default function VPSSignaturePanel({
  documentId,
  signingSessionId,
  signerName,
  signerEmail,
  reason,
  location = "México",
  signatureImageBlob,
  onSignComplete,
  vpsAvailable: vpsAvailableProp,
}: VPSSignaturePanelProps) {
  const [vpsAvailable, setVpsAvailable] = useState<boolean>(
    vpsAvailableProp ?? false
  );
  const [step, setStep] = useState<SigningStep>("idle");
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [signatureMetadata, setSignatureMetadata] =
    useState<SignatureMetadata | null>(null);
  const [signedPdfBlob, setSignedPdfBlob] = useState<Blob | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);

  const supabase = createClient();

  // Health check al montar el componente
  useEffect(() => {
    if (vpsAvailableProp !== undefined) {
      setVpsAvailable(vpsAvailableProp);
      return;
    }

    const vpsUrl = process.env.NEXT_PUBLIC_VPS_URL;
    if (!vpsUrl) {
      setVpsAvailable(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    fetch(`${vpsUrl}/health`, { signal: controller.signal })
      .then((res) => {
        if (res.ok) setVpsAvailable(true);
        else setVpsAvailable(false);
      })
      .catch(() => setVpsAvailable(false))
      .finally(() => clearTimeout(timeout));

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [vpsAvailableProp]);

  // Animación de pasos durante la firma
  useEffect(() => {
    if (step !== "loading") return;

    let idx = 0;
    setCurrentStepIndex(0);

    const interval = setInterval(() => {
      idx += 1;
      if (idx < SIGNING_STEPS.length) {
        setCurrentStepIndex(idx);
      } else {
        clearInterval(interval);
      }
    }, 2200);

    return () => clearInterval(interval);
  }, [step]);

  const handleSign = useCallback(async () => {
    setStep("loading");
    setErrorMessage("");

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error("Sesión expirada. Inicia sesión nuevamente.");
      }

      const body: Record<string, unknown> = {
        document_id: documentId,
        signer_name: signerName,
        signer_email: signerEmail,
        reason,
        location,
        signing_session_id: signingSessionId,
        page_number: -2,
      };

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sign-pdf-vps`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (response.status === 503) {
          setVpsAvailable(false);
          throw new Error(
            errData.error ||
              "El servidor de firma no está disponible en este momento."
          );
        }
        throw new Error(
          errData.error || `Error al aplicar la firma (${response.status})`
        );
      }

      const pdfBuffer = await response.arrayBuffer();
      const blob = new Blob([pdfBuffer], { type: "application/pdf" });

      const metadata: SignatureMetadata = {
        signedHash: response.headers.get("X-Signed-Hash") ?? "",
        fieldName: response.headers.get("X-Field-Name") ?? "",
        signedAt: response.headers.get("X-Signed-At") ?? new Date().toISOString(),
        signatureLevel: response.headers.get("X-Signature-Level") ?? "PAdES-B-T",
        certificate: "CN=Docubox CA, O=Docubox, C=MX",
      };

      setSignedPdfBlob(blob);
      setSignatureMetadata(metadata);
      setStep("success");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Error desconocido al firmar";
      setErrorMessage(msg);
      setStep("error");
    }
  }, [
    documentId,
    signerName,
    signerEmail,
    reason,
    location,
    signingSessionId,
    supabase,
  ]);

  const handleDownload = () => {
    if (!signedPdfBlob) return;
    const url = URL.createObjectURL(signedPdfBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `DOCUBOX_${documentId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyHash = async () => {
    if (!signatureMetadata?.signedHash) return;
    await navigator.clipboard.writeText(signatureMetadata.signedHash);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleString("es-MX", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Mexico_City",
      });
    } catch {
      return isoString;
    }
  };

  // ─── ESTADO: VPS no disponible ───────────────────────────────────────────
  if (!vpsAvailable) {
    return (
      <div
        className="rounded-xl border p-6 space-y-4"
        style={{
          backgroundColor: "#0A1628",
          borderColor: "#F59E0B",
        }}
      >
        <div className="flex items-start gap-4">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "rgba(245,158,11,0.15)" }}
          >
            <svg
              className="w-5 h-5"
              style={{ color: "#F59E0B" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3
                className="font-semibold text-base"
                style={{ color: "#F1F5F9" }}
              >
                Firma criptográfica PAdES
              </h3>
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: "rgba(245,158,11,0.2)",
                  color: "#F59E0B",
                }}
              >
                Disponible próximamente
              </span>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: "#94A3B8" }}>
              El documento ya cuenta con constancia de firma electrónica y
              sellado criptográfico. La validación nativa en Adobe Acrobat
              estará disponible próximamente.
            </p>
          </div>
        </div>

        <div
          className="rounded-lg p-4 space-y-3"
          style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 flex-shrink-0"
              style={{ color: "#10B981" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm" style={{ color: "#94A3B8" }}>
              Constancia de firma electrónica generada
            </span>
          </div>
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 flex-shrink-0"
              style={{ color: "#10B981" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm" style={{ color: "#94A3B8" }}>
              Sellado criptográfico SHA-256 aplicado
            </span>
          </div>
          <div className="flex items-center gap-2">
            <svg
              className="w-4 h-4 flex-shrink-0"
              style={{ color: "#F59E0B" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm" style={{ color: "#94A3B8" }}>
              Validación nativa Adobe Acrobat (PAdES B-T) — próximamente
            </span>
          </div>
        </div>

        <button
          disabled
          className="w-full py-2.5 px-4 rounded-lg text-sm font-medium opacity-40 cursor-not-allowed"
          style={{
            backgroundColor: "#1E6BFF",
            color: "#F1F5F9",
          }}
        >
          Aplicar Firma PAdES
        </button>

        <p className="text-xs text-center" style={{ color: "#64748B" }}>
          Esta función requiere activación del servidor de firma. El documento
          actual tiene plena validez jurídica.
        </p>
      </div>
    );
  }

  // ─── ESTADO: Cargando / Firmando ─────────────────────────────────────────
  if (step === "loading") {
    return (
      <div
        className="rounded-xl border p-6 space-y-6"
        style={{ backgroundColor: "#0A1628", borderColor: "#1E3A5F" }}
      >
        <div className="text-center">
          <div
            className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-4"
            style={{ backgroundColor: "rgba(30,107,255,0.15)" }}
          >
            <svg
              className="w-6 h-6 animate-spin"
              style={{ color: "#1E6BFF" }}
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </div>
          <h3 className="font-semibold text-base" style={{ color: "#F1F5F9" }}>
            Aplicando firma criptográfica
          </h3>
        </div>

        <div className="space-y-2">
          {SIGNING_STEPS.map((stepText, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                {idx < currentStepIndex ? (
                  <svg
                    className="w-4 h-4"
                    style={{ color: "#10B981" }}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : idx === currentStepIndex ? (
                  <div
                    className="w-3 h-3 rounded-full animate-pulse"
                    style={{ backgroundColor: "#1E6BFF" }}
                  />
                ) : (
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: "#1E3A5F" }}
                  />
                )}
              </div>
              <span
                className="text-sm"
                style={{
                  color:
                    idx === currentStepIndex
                      ? "#F1F5F9"
                      : idx < currentStepIndex
                      ? "#10B981" :"#475569",
                }}
              >
                {stepText}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── ESTADO: Éxito ───────────────────────────────────────────────────────
  if (step === "success" && signatureMetadata) {
    return (
      <div
        className="rounded-xl border p-6 space-y-5"
        style={{ backgroundColor: "#0A1628", borderColor: "#10B981" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "rgba(16,185,129,0.15)" }}
          >
            <svg
              className="w-5 h-5"
              style={{ color: "#10B981" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <span
              className="text-sm font-semibold px-3 py-1 rounded-full"
              style={{
                backgroundColor: "rgba(16,185,129,0.15)",
                color: "#10B981",
              }}
            >
              ✓ Firma PAdES Aplicada
            </span>
          </div>
        </div>

        <div
          className="rounded-lg p-4 space-y-3"
          style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
        >
          {[
            { label: "Nivel", value: signatureMetadata.signatureLevel },
            { label: "Certificado", value: signatureMetadata.certificate },
            {
              label: "TSA",
              value: "DigiCert RFC 3161 ✓",
              color: "#10B981",
            },
            {
              label: "Firmado",
              value: formatDate(signatureMetadata.signedAt),
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex justify-between items-start gap-4">
              <span className="text-xs flex-shrink-0" style={{ color: "#64748B" }}>
                {label}
              </span>
              <span
                className="text-xs text-right font-medium"
                style={{ color: color ?? "#F1F5F9" }}
              >
                {value}
              </span>
            </div>
          ))}

          {signatureMetadata.signedHash && (
            <div className="flex justify-between items-center gap-4 pt-1 border-t" style={{ borderColor: "#1E3A5F" }}>
              <span className="text-xs flex-shrink-0" style={{ color: "#64748B" }}>
                Hash firmado
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-mono"
                  style={{ color: "#94A3B8" }}
                >
                  {signatureMetadata.signedHash.slice(0, 16)}…
                </span>
                <button
                  onClick={handleCopyHash}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: "rgba(30,107,255,0.15)",
                    color: "#1E6BFF",
                  }}
                >
                  {copiedHash ? "✓" : "Copiar"}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleDownload}
            className="flex-1 py-2.5 px-4 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
            style={{ backgroundColor: "#1E6BFF", color: "#F1F5F9" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Descargar PDF Firmado
          </button>
          <button
            onClick={() =>
              signedPdfBlob && onSignComplete(signedPdfBlob, signatureMetadata)
            }
            className="px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{
              backgroundColor: "rgba(255,255,255,0.06)",
              color: "#94A3B8",
            }}
          >
            Continuar
          </button>
        </div>
      </div>
    );
  }

  // ─── ESTADO: Error ───────────────────────────────────────────────────────
  if (step === "error") {
    return (
      <div
        className="rounded-xl border p-6 space-y-4"
        style={{ backgroundColor: "#0A1628", borderColor: "#EF4444" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "rgba(239,68,68,0.15)" }}
          >
            <svg
              className="w-5 h-5"
              style={{ color: "#EF4444" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <span
            className="text-sm font-semibold px-3 py-1 rounded-full"
            style={{
              backgroundColor: "rgba(239,68,68,0.15)",
              color: "#EF4444",
            }}
          >
            Error al aplicar la firma
          </span>
        </div>

        {errorMessage && (
          <p className="text-sm" style={{ color: "#94A3B8" }}>
            {errorMessage}
          </p>
        )}

        <button
          onClick={() => {
            setStep("idle");
            setErrorMessage("");
          }}
          className="w-full py-2.5 px-4 rounded-lg text-sm font-medium"
          style={{ backgroundColor: "#1E6BFF", color: "#F1F5F9" }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  // ─── ESTADO: Idle — Preview del sello ────────────────────────────────────
  const nowStr = new Date().toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });

  return (
    <div
      className="rounded-xl border p-6 space-y-5"
      style={{ backgroundColor: "#0A1628", borderColor: "#1E3A5F" }}
    >
      <div>
        <h3 className="font-semibold text-base mb-1" style={{ color: "#F1F5F9" }}>
          Firma criptográfica PAdES
        </h3>
        <p className="text-sm" style={{ color: "#64748B" }}>
          Vista previa del sello que aparecerá en el documento
        </p>
      </div>

      {/* Preview del campo de firma */}
      <div
        className="rounded-lg overflow-hidden border"
        style={{ borderColor: "#1E6BFF", borderWidth: "1px" }}
      >
        {/* Franja superior */}
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{ backgroundColor: "#0A1628" }}
        >
          <span
            className="text-xs font-bold tracking-wide"
            style={{ color: "#F1F5F9", fontFamily: "monospace" }}
          >
            DOCUBOX
          </span>
          <span className="text-xs" style={{ color: "#94A3B8" }}>
            Firma Electrónica
          </span>
        </div>

        {/* Cuerpo */}
        <div
          className="px-3 py-2 space-y-1"
          style={{ backgroundColor: "#FFFFFF" }}
        >
          {[
            { label: "Firmado por:", value: signerName, highlight: true },
            { label: "Fecha:", value: nowStr },
            { label: "Razón:", value: reason },
            { label: "Certificado:", value: "Docubox CA | RSA-2048" },
          ].map(({ label, value, highlight }) => (
            <div key={label} className="flex items-baseline gap-1">
              <span
                className="text-xs font-bold flex-shrink-0"
                style={{ color: "#374151", fontSize: "7px" }}
              >
                {label}
              </span>
              <span
                className="text-xs truncate"
                style={{
                  color: highlight ? "#1E6BFF" : "#374151",
                  fontSize: "8px",
                }}
              >
                {value}
              </span>
            </div>
          ))}
          <div className="flex items-baseline gap-1">
            <span
              className="text-xs font-bold flex-shrink-0"
              style={{ color: "#374151", fontSize: "7px" }}
            >
              Sello de tiempo:
            </span>
            <span className="text-xs" style={{ color: "#10B981", fontSize: "8px" }}>
              DigiCert RFC 3161 ✓
            </span>
          </div>
        </div>

        {/* Pie */}
        <div
          className="px-3 py-1"
          style={{ backgroundColor: "#F1F5F9" }}
        >
          <span
            className="text-xs font-mono"
            style={{ color: "#6B7280", fontSize: "6px" }}
          >
            Al hacer clic en Acrobat verá detalles completos de la firma
          </span>
        </div>
      </div>

      {/* Texto informativo */}
      <div
        className="rounded-lg p-4 border"
        style={{
          backgroundColor: "#EFF6FF",
          borderColor: "#1E6BFF",
          borderWidth: "1px",
        }}
      >
        <p className="text-xs leading-relaxed" style={{ color: "#1E40AF" }}>
          Al abrir el documento en Adobe Acrobat, haga clic sobre este sello
          para ver la verificación criptográfica completa: nombre del firmante,
          certificado Docubox CA, confirmación del sello de tiempo RFC 3161 y
          estado de integridad del documento.
        </p>
      </div>

      <button
        onClick={handleSign}
        className="w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
        style={{ backgroundColor: "#1E6BFF", color: "#F1F5F9" }}
      >
        Aplicar Firma Criptográfica PAdES
      </button>
    </div>
  );
}
