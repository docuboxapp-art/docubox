"""
DOCUBOX — Módulo principal de firma PAdES con pyHanko
Aplica firma criptográfica PAdES B-T al PDF que ya viene procesado por seal-pdf.
"""

import io
import time
import hashlib
import datetime
import os
import urllib.request
import urllib.parse
import json

from pyhanko.sign import signers, fields
from pyhanko.sign.signers.pdf_signer import PdfSignatureMetadata
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign.fields import SigSeedSubFilter
from pyhanko.sign.timestamps import HTTPTimeStamper

from . import cert_loader
from . import appearance as appearance_module

# URL del servidor de sellado de tiempo (configurable)
TSA_URL = os.environ.get("TSA_URL", "http://timestamp.digicert.com")

# URL de Supabase para actualizar document_signature_seals
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def _calculate_sha256(data: bytes) -> str:
    """Calcula hash SHA-256 de los bytes dados."""
    return hashlib.sha256(data).hexdigest()


def _update_supabase_seal(document_id: str, signed_hash: str) -> bool:
    """
    Actualiza document_signature_seals en Supabase vía HTTP.
    Usa urllib para evitar dependencias adicionales.
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return False

    try:
        url = f"{SUPABASE_URL}/rest/v1/document_signature_seals"
        params = urllib.parse.urlencode({"document_id": f"eq.{document_id}"})
        full_url = f"{url}?{params}"

        payload = json.dumps({
            "signed_hash": signed_hash,
            "timestamp_applied": True,
            "certificate_cn": "Docubox CA",
        }).encode("utf-8")

        req = urllib.request.Request(
            full_url,
            data=payload,
            method="PATCH",
            headers={
                "Content-Type": "application/json",
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Prefer": "return=minimal",
            },
        )

        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 204)

    except Exception as e:
        print(f"[DOCUBOX] Advertencia: No se pudo actualizar Supabase: {e}")
        return False


def sign_pdf(
    pdf_bytes: bytes,
    document_id: str,
    signer_name: str,
    signer_email: str,
    reason: str,
    location: str,
    ip_address: str,
    page_number: int = -2,
    field_x: float = None,
    field_y: float = None,
    signature_image_bytes: bytes = None,
    signing_session_id: str = None,
) -> dict:
    """
    Aplica firma criptográfica PAdES B-T al PDF recibido.

    page_number=-2 significa penúltima página (antes de la constancia de seal-pdf).
    Esta es la convención fija del proyecto DOCUBOX.

    Args:
        pdf_bytes: PDF ya procesado por seal-pdf (con constancia visual)
        document_id: ID del documento en Supabase
        signer_name: Nombre completo del firmante
        signer_email: Correo electrónico del firmante
        reason: Razón de la firma
        location: Ubicación del firmante (default "México")
        ip_address: IP del firmante
        page_number: Página donde colocar el campo (-2 = penúltima)
        field_x: Posición X del campo (None = automático)
        field_y: Posición Y del campo (None = automático)
        signature_image_bytes: PNG de firma autógrafa (opcional)
        signing_session_id: ID de la sesión de firma en Supabase

    Returns:
        dict con resultado de la firma
    """

    # PASO 1 — Calcular hash del PDF recibido
    original_hash = _calculate_sha256(pdf_bytes)

    # PASO 2 — Determinar posición del campo de firma
    pdf_reader = PdfFileReader(io.BytesIO(pdf_bytes))
    total_pages = len(pdf_reader.root["/Pages"]["/Kids"])

    # Resolver page_number negativo
    if page_number < 0:
        resolved_page = total_pages + page_number
        if resolved_page < 0:
            resolved_page = 0
    else:
        resolved_page = min(page_number, total_pages - 1)

    # Obtener dimensiones de la página
    page_obj = pdf_reader.root["/Pages"]["/Kids"][resolved_page].get_object()
    media_box = page_obj.get("/MediaBox", [0, 0, 612, 792])
    page_width = float(media_box[2])
    page_height = float(media_box[3])

    # Posición automática: esquina inferior derecha con margen de 20pt
    if field_x is None:
        field_x = page_width - 260.0
    if field_y is None:
        field_y = 20.0

    field_width = 240.0
    field_height = 80.0

    # Nombre único del campo de firma
    timestamp_int = int(time.time())
    email_safe = signer_email.replace("@", "_at_").replace(".", "_")
    field_name = f"DocuboxSig_{email_safe}_{timestamp_int}"

    # PASO 3 — Crear campo de firma en el PDF
    pdf_writer = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))

    sig_field_spec = fields.SigFieldSpec(
        sig_field_name=field_name,
        on_page=resolved_page,
        box=(field_x, field_y, field_x + field_width, field_y + field_height),
    )

    fields.append_signature_field(pdf_writer, sig_field_spec)

    # PASO 4 — Configurar PdfSignatureMetadata
    # certify=False es OBLIGATORIO para soportar múltiples firmantes
    # sin invalidar firmas previas
    sig_meta = PdfSignatureMetadata(
        field_name=field_name,
        reason=reason,
        location=location,
        name=signer_name,
        subfilter=SigSeedSubFilter.PADES,
        certify=False,
    )

    # PASO 5 — Aplicar firma PAdES B-T
    signed_at = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=-6)))

    signer_data = {
        "signer_name": signer_name,
        "reason": reason,
        "signed_at": signed_at,
        "original_hash": original_hash,
        "signature_image_bytes": signature_image_bytes,
    }

    stamp_style = appearance_module.build_stamp_style(signer_data)

    # Cargar signer con certificado
    pdf_signer = cert_loader.load_signer()

    # Configurar sellado de tiempo RFC 3161
    timestamper = HTTPTimeStamper(TSA_URL)

    # Buffer de salida
    output_buffer = io.BytesIO()

    # Aplicar firma
    sign_kwargs = {
        "writer": pdf_writer,
        "signer": pdf_signer,
        "timestamper": timestamper,
        "signature_meta": sig_meta,
        "existing_fields_only": False,
    }

    if stamp_style is not None:
        sign_kwargs["appearance"] = stamp_style

    signers.sign_pdf(**sign_kwargs, output=output_buffer)

    signed_pdf_bytes = output_buffer.getvalue()

    # PASO 6 — Hash del PDF firmado
    signed_hash = _calculate_sha256(signed_pdf_bytes)

    # PASO 7 — Actualizar Supabase
    _update_supabase_seal(document_id, signed_hash)

    # PASO 8 — Retornar resultado
    signed_at_iso = signed_at.isoformat()

    return {
        "success": True,
        "pdf_bytes": signed_pdf_bytes,
        "original_hash": original_hash,
        "signed_hash": signed_hash,
        "field_name": field_name,
        "signed_at": signed_at_iso,
        "certificate_subject": "CN=Docubox CA,O=Docubox,C=MX",
        "timestamp_applied": True,
        "signature_level": "PAdES-B-T",
    }
