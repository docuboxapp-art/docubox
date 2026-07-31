"""
DOCUBOX — Apariencia visual del campo de firma PAdES
Define el sello visible que aparece en el PDF y que Acrobat muestra al hacer clic.
"""

import datetime
from pyhanko.sign.fields import SigFieldSpec
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign.signers.pdf_signer import PdfSignatureMetadata

# Colores DOCUBOX (valores 0-1 para pdf-lib/pyHanko)
COLOR_DARK_BG = (10/255, 22/255, 40/255)       # #0A1628
COLOR_PRIMARY = (30/255, 107/255, 255/255)      # #1E6BFF
COLOR_SUCCESS = (16/255, 185/255, 129/255)      # #10B981
COLOR_TEXT_LIGHT = (241/255, 245/255, 249/255)  # #F1F5F9
COLOR_LABEL = (55/255, 65/255, 81/255)          # #374151
COLOR_FOOTER_BG = (239/255, 246/255, 255/255)   # #EFF6FF (aprox #F1F5F9)
COLOR_HASH = (107/255, 114/255, 128/255)        # #6B7280
COLOR_WHITE = (1.0, 1.0, 1.0)


def build_stamp_style(signer_data: dict):
    """
    Construye el estilo de apariencia para el campo de firma visible en el PDF.

    Args:
        signer_data: dict con claves:
            - signer_name: str
            - reason: str
            - signed_at: datetime (UTC-6)
            - original_hash: str (64 chars SHA-256)
            - signature_image_bytes: bytes | None (PNG de firma autógrafa)

    Returns:
        TextStampStyle de pyHanko configurado con el diseño DOCUBOX.
    """
    from pyhanko.stamp import TextStampStyle, TextStampContent
    from pyhanko.pdf_utils import layout
    from pyhanko.pdf_utils.font import GlyphAccumulatorFactory

    signer_name = signer_data.get("signer_name", "")
    reason = signer_data.get("reason", "")
    signed_at = signer_data.get("signed_at", datetime.datetime.now())
    original_hash = signer_data.get("original_hash", "")
    signature_image_bytes = signer_data.get("signature_image_bytes", None)

    # Formatear fecha en CST (UTC-6)
    if isinstance(signed_at, datetime.datetime):
        fecha_str = signed_at.strftime("%d/%m/%Y %H:%M CST")
    else:
        fecha_str = str(signed_at)

    # Hash truncado a 16 caracteres para el pie
    hash_truncado = original_hash[:16] if original_hash else "—"

    # Construir texto del sello
    # Líneas del cuerpo del sello
    stamp_lines = [
        f"Firmado por: {signer_name}",
        f"Fecha: {fecha_str}",
        f"Razón: {reason}",
        "Certificado: Docubox CA | RSA-2048",
        "Sello de tiempo: DigiCert RFC 3161  ✓",
    ]

    # Usar TextStampStyle de pyHanko para el campo de firma
    # El diseño completo se implementa via stamp_text con formato multilínea
    stamp_text = (
        "DOCUBOX                    Firma Electrónica\n" "─────────────────────────────────────────\n" +"\n".join(stamp_lines)
        + f"\n─────────────────────────────────────────\n" + f"{hash_truncado}…"
    )

    try:
        from pyhanko.stamp import TextStampStyle
        from pyhanko.pdf_utils.layout import SimpleBoxLayoutRule

        style = TextStampStyle(
            stamp_text=stamp_text,
            text_box_style=layout.TextBoxStyle(
                font_size=7,
                leading=9,
                vertical_center=False,
            ),
            background_opacity=1.0,
        )
        return style
    except Exception:
        # Fallback: retornar None para usar apariencia por defecto de pyHanko
        return None


def get_stamp_text(signer_data: dict) -> str:
    """
    Genera el texto del sello de firma para pyHanko.
    Usado como fallback cuando build_stamp_style no está disponible.
    """
    signer_name = signer_data.get("signer_name", "")
    reason = signer_data.get("reason", "")
    signed_at = signer_data.get("signed_at", datetime.datetime.now())
    original_hash = signer_data.get("original_hash", "")

    if isinstance(signed_at, datetime.datetime):
        fecha_str = signed_at.strftime("%d/%m/%Y %H:%M CST")
    else:
        fecha_str = str(signed_at)

    hash_truncado = original_hash[:16] if original_hash else "—"

    return (
        f"DOCUBOX — Firma Electronica\n" f"Firmado por: {signer_name}\n" f"Fecha: {fecha_str}\n" f"Razon: {reason}\n" f"Certificado: Docubox CA | RSA-2048\n" f"TSA: DigiCert RFC 3161\n" f"Hash: {hash_truncado}..."
    )
