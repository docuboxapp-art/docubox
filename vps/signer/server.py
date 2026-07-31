"""
DOCUBOX — Servidor HTTP minimalista para firma PAdES
Expone endpoints /sign, /verify y /health usando http.server de Python estándar.
Sin frameworks externos. Solo librería estándar + pyHanko + cryptography.
"""

import io
import os
import json
import cgi
import sys
import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

# Agregar directorio padre al path para importar módulos signer
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from signer import cert_loader
from signer import pades_core

# Configuración
PORT = int(os.environ.get("SIGNING_PORT", 8001))
VPS_SECRET_TOKEN = os.environ.get("VPS_SECRET_TOKEN", "")
TSA_URL = os.environ.get("TSA_URL", "http://timestamp.digicert.com")
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def _json_response(handler, status: int, data: dict):
    """Envía respuesta JSON."""
    body = json.dumps(data, ensure_ascii=False, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


def _validate_token(handler) -> bool:
    """Valida el header X-VPS-Token."""
    if not VPS_SECRET_TOKEN:
        # Si no hay token configurado, rechazar siempre
        _json_response(handler, 401, {"error": "Servidor no configurado correctamente"})
        return False

    token = handler.headers.get("X-VPS-Token", "")
    if token != VPS_SECRET_TOKEN:
        _json_response(handler, 401, {"error": "Token de autenticación inválido"})
        return False

    return True


def _handle_sign(handler):
    """POST /sign — Aplica firma PAdES al PDF recibido."""
    if not _validate_token(handler):
        return

    content_type = handler.headers.get("Content-Type", "")
    if "multipart/form-data" not in content_type:
        _json_response(handler, 400, {"error": "Se requiere Content-Type: multipart/form-data"})
        return

    # Parsear multipart/form-data
    content_length = int(handler.headers.get("Content-Length", 0))
    if content_length > MAX_FILE_SIZE + 1024:  # +1KB para campos de texto
        _json_response(handler, 413, {"error": "El archivo excede el tamaño máximo de 20MB"})
        return

    environ = {
        "REQUEST_METHOD": "POST",
        "CONTENT_TYPE": content_type,
        "CONTENT_LENGTH": str(content_length),
    }

    form = cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ=environ,
    )

    # Extraer archivo PDF
    if "file" not in form:
        _json_response(handler, 400, {"error": "Campo 'file' requerido"})
        return

    pdf_field = form["file"]
    pdf_bytes = pdf_field.file.read() if hasattr(pdf_field, "file") else pdf_field.value

    # Validar que sea un PDF real
    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        _json_response(handler, 422, {"error": "El archivo no es un PDF válido"})
        return

    if len(pdf_bytes) > MAX_FILE_SIZE:
        _json_response(handler, 413, {"error": "El archivo excede el tamaño máximo de 20MB"})
        return

    # Extraer campos del formulario
    def get_field(name, default=""):
        if name in form:
            val = form[name]
            return val.value if hasattr(val, "value") else str(val)
        return default

    document_id = get_field("document_id")
    signer_name = get_field("signer_name")
    signer_email = get_field("signer_email")
    reason = get_field("reason")
    location = get_field("location", "México")
    ip_address = get_field("ip_address")
    signing_session_id = get_field("signing_session_id", None)

    # Validar campos requeridos
    for campo, valor in [
        ("document_id", document_id),
        ("signer_name", signer_name),
        ("signer_email", signer_email),
        ("reason", reason),
        ("ip_address", ip_address),
    ]:
        if not valor:
            _json_response(handler, 400, {"error": f"Campo '{campo}' requerido"})
            return

    # Campos opcionales numéricos
    try:
        page_number = int(get_field("page_number", "-2"))
    except ValueError:
        page_number = -2

    try:
        field_x_str = get_field("field_x", "")
        field_x = float(field_x_str) if field_x_str else None
    except ValueError:
        field_x = None

    try:
        field_y_str = get_field("field_y", "")
        field_y = float(field_y_str) if field_y_str else None
    except ValueError:
        field_y = None

    # Imagen de firma autógrafa (opcional)
    signature_image_bytes = None
    if "signature_image" in form:
        sig_field = form["signature_image"]
        signature_image_bytes = sig_field.file.read() if hasattr(sig_field, "file") else sig_field.value

    # Aplicar firma PAdES
    try:
        result = pades_core.sign_pdf(
            pdf_bytes=pdf_bytes,
            document_id=document_id,
            signer_name=signer_name,
            signer_email=signer_email,
            reason=reason,
            location=location,
            ip_address=ip_address,
            page_number=page_number,
            field_x=field_x,
            field_y=field_y,
            signature_image_bytes=signature_image_bytes,
            signing_session_id=signing_session_id,
        )
    except Exception as e:
        print(f"[DOCUBOX] Error al firmar: {e}")
        _json_response(handler, 500, {"error": f"Error al aplicar la firma: {str(e)}"})
        return

    # Retornar PDF firmado como bytes
    signed_pdf = result["pdf_bytes"]
    filename = f"DOCUBOX_{document_id}.pdf"

    handler.send_response(200)
    handler.send_header("Content-Type", "application/pdf")
    handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.send_header("Content-Length", str(len(signed_pdf)))
    handler.send_header("X-Signed-Hash", result["signed_hash"])
    handler.send_header("X-Original-Hash", result["original_hash"])
    handler.send_header("X-Field-Name", result["field_name"])
    handler.send_header("X-Signed-At", result["signed_at"])
    handler.send_header("X-Signature-Level", "PAdES-B-T")
    handler.send_header("X-Certificate", "CN=Docubox CA,O=Docubox,C=MX")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(signed_pdf)


def _handle_verify(handler):
    """POST /verify — Verifica las firmas de un PDF."""
    if not _validate_token(handler):
        return

    content_type = handler.headers.get("Content-Type", "")
    if "multipart/form-data" not in content_type:
        _json_response(handler, 400, {"error": "Se requiere Content-Type: multipart/form-data"})
        return

    content_length = int(handler.headers.get("Content-Length", 0))
    environ = {
        "REQUEST_METHOD": "POST",
        "CONTENT_TYPE": content_type,
        "CONTENT_LENGTH": str(content_length),
    }

    form = cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ=environ,
    )

    if "file" not in form:
        _json_response(handler, 400, {"error": "Campo 'file' requerido"})
        return

    pdf_field = form["file"]
    pdf_bytes = pdf_field.file.read() if hasattr(pdf_field, "file") else pdf_field.value

    if not pdf_bytes or not pdf_bytes.startswith(b"%PDF"):
        _json_response(handler, 422, {"error": "El archivo no es un PDF válido"})
        return

    try:
        from pyhanko.sign import validation
        from pyhanko.pdf_utils.reader import PdfFileReader

        reader = PdfFileReader(io.BytesIO(pdf_bytes))
        sig_results = []

        embedded_sigs = reader.embedded_signatures
        for sig in embedded_sigs:
            try:
                status = validation.validate_pdf_signature(sig)
                ts_time = None
                if status.timestamp_validity and status.timestamp_validity.timestamp:
                    ts_time = status.timestamp_validity.timestamp.isoformat()

                sig_results.append({
                    "field_name": sig.field_name,
                    "signer_name": str(status.signer_reported_dt) if status.signer_reported_dt else "",
                    "signed_at": status.signer_reported_dt.isoformat() if status.signer_reported_dt else None,
                    "reason": sig.sig_object.get("/Reason", ""),
                    "location": sig.sig_object.get("/Location", ""),
                    "certificate_subject": str(status.signing_cert.subject.rfc4514_string()) if status.signing_cert else "",
                    "timestamp_present": status.timestamp_validity is not None,
                    "timestamp_time": ts_time,
                    "document_modified_after_signing": not status.coverage == "WHOLE_FILE",
                    "intact": status.intact,
                })
            except Exception as sig_err:
                sig_results.append({
                    "field_name": getattr(sig, "field_name", "desconocido"),
                    "error": str(sig_err),
                    "intact": False,
                })

        all_valid = all(s.get("intact", False) for s in sig_results) if sig_results else False

        _json_response(handler, 200, {
            "valid": all_valid,
            "total_signatures": len(sig_results),
            "signatures": sig_results,
        })

    except Exception as e:
        _json_response(handler, 500, {"error": f"Error al verificar: {str(e)}"})


def _handle_health(handler):
    """GET /health — Estado del servidor (sin autenticación)."""
    import pyhanko

    cert_info = cert_loader.get_certificate_info()

    _json_response(handler, 200, {
        "status": "ok",
        "certificate_loaded": cert_info["loaded"],
        "certificate_subject": cert_info.get("subject", ""),
        "certificate_expires_in_days": cert_info.get("expires_in_days", 0),
        "tsa_url": TSA_URL,
        "pyhanko_version": getattr(pyhanko, "__version__", "desconocido"),
    })


class DocuboxSigningHandler(BaseHTTPRequestHandler):
    """Handler HTTP para el servidor de firma DOCUBOX."""

    def log_message(self, format, *args):
        """Formato de log personalizado."""
        print(f"[DOCUBOX] {self.address_string()} - {format % args}")

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "X-VPS-Token, Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            _handle_health(self)
        else:
            _json_response(self, 404, {"error": "Endpoint no encontrado"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/sign":
            _handle_sign(self)
        elif path == "/verify":
            _handle_verify(self)
        else:
            _json_response(self, 404, {"error": "Endpoint no encontrado"})


def main():
    """Punto de entrada del servidor de firma DOCUBOX."""

    # Verificar que el certificado esté disponible al arrancar
    try:
        signer = cert_loader.load_signer()
        cert_info = cert_loader.get_certificate_info()
        print(f"\n{'='*60}")
        print("DOCUBOX Signing Server activo en puerto", PORT)
        print(f"Certificado: {cert_info.get('subject', 'N/A')}, vence en {cert_info.get('expires_in_days', 0)} días")
        print(f"TSA: {TSA_URL}")
        print(f"{'='*60}\n")
    except FileNotFoundError as e:
        print(f"\n[ERROR] {e}")
        print("Ejecuta primero: python generate_cert.py")
        sys.exit(1)
    except Exception as e:
        print(f"\n[ERROR] No se pudo cargar el certificado: {e}")
        sys.exit(1)

    server = HTTPServer(("0.0.0.0", PORT), DocuboxSigningHandler)
    print(f"Servidor escuchando en 0.0.0.0:{PORT}")
    print("Presiona Ctrl+C para detener.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[DOCUBOX] Servidor detenido.")
        server.server_close()


if __name__ == "__main__":
    main()
