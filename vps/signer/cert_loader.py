"""
DOCUBOX — Cargador de certificado X.509 para firma PAdES
Carga la clave privada y el certificado desde disco y retorna un SimpleSigner.
"""

import os
from pyhanko.sign import signers

CERT_PATH = os.environ.get("CERT_PATH", "certs/docubox.crt")
KEY_PATH = os.environ.get("KEY_PATH", "certs/docubox.key")

# Signer en caché — se carga una sola vez en RAM al arrancar el servidor
_signer_instance = None


def load_signer() -> signers.SimpleSigner:
    """
    Carga la clave privada y el certificado desde disco.
    Retorna un SimpleSigner de pyHanko listo para usar.
    La clave se mantiene en RAM durante la vida del proceso.
    Nunca se reescribe a disco.
    """
    global _signer_instance

    if _signer_instance is not None:
        return _signer_instance

    if not os.path.exists(KEY_PATH):
        raise FileNotFoundError(
            f"No se encontró la clave privada en '{KEY_PATH}'. "
            "Ejecuta primero: python generate_cert.py"
        )

    if not os.path.exists(CERT_PATH):
        raise FileNotFoundError(
            f"No se encontró el certificado en '{CERT_PATH}'. "
            "Ejecuta primero: python generate_cert.py"
        )

    try:
        _signer_instance = signers.SimpleSigner.load(
            key_file=KEY_PATH,
            cert_file=CERT_PATH,
            key_passphrase=None,
        )
    except Exception as e:
        raise RuntimeError(
            f"Error al cargar el certificado de firma: {e}. "
            "Verifica que los archivos en certs/ sean válidos y no estén corruptos."
        )

    return _signer_instance


def get_certificate_info() -> dict:
    """Retorna información del certificado cargado para el health check."""
    import datetime
    from cryptography import x509
    from cryptography.hazmat.primitives.serialization import Encoding

    if not os.path.exists(CERT_PATH):
        return {
            "loaded": False,
            "subject": None,
            "expires_in_days": None,
        }

    with open(CERT_PATH, "rb") as f:
        cert_data = f.read()

    cert = x509.load_pem_x509_certificate(cert_data)
    now = datetime.datetime.now(datetime.timezone.utc)
    expires_in = (cert.not_valid_after_utc - now).days

    return {
        "loaded": True,
        "subject": cert.subject.rfc4514_string(),
        "expires_in_days": expires_in,
    }
