"""
DOCUBOX — Generador de certificado X.509 para firma PAdES
Ejecutar UNA SOLA VEZ en el VPS para generar el certificado de firma.

Uso:
    python generate_cert.py
"""

import os
import datetime
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509 import ObjectIdentifier

# Directorio donde se guardarán los certificados
CERTS_DIR = "certs"
KEY_PATH = os.path.join(CERTS_DIR, "docubox.key")
CERT_PATH = os.path.join(CERTS_DIR, "docubox.crt")

# OID requerido por Adobe Acrobat para reconocer el campo de firma
ADOBE_PDF_SIGNING_OID = ObjectIdentifier("1.2.840.113583.1.1.5")


def generate_certificate():
    """Genera clave privada RSA 2048 y certificado X.509 v3 autofirmado."""

    # Crear directorio certs/ si no existe
    os.makedirs(CERTS_DIR, exist_ok=True)

    # Verificar si ya existen los archivos
    if os.path.exists(KEY_PATH) or os.path.exists(CERT_PATH):
        respuesta = input(
            "⚠️  Ya existen archivos en certs/. ¿Desea sobreescribirlos? (s/N): "
        ).strip().lower()
        if respuesta != "s":
            print("Operación cancelada. Los archivos existentes no fueron modificados.")
            return

    print("Generando clave privada RSA 2048 bits...")

    # Generar clave privada RSA 2048
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    # Definir subject e issuer (autofirmado → son iguales)
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Docubox CA"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Docubox"),
        x509.NameAttribute(NameOID.COUNTRY_NAME, "MX"),
    ])

    # Fechas de validez: 825 días desde hoy
    now = datetime.datetime.utcnow()
    not_before = now
    not_after = now + datetime.timedelta(days=825)

    # Construir certificado X.509 v3
    print("Construyendo certificado X.509 v3...")

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(not_before)
        .not_valid_after(not_after)
        # BasicConstraints: CA:FALSE
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None),
            critical=True,
        )
        # KeyUsage: digitalSignature, nonRepudiation, contentCommitment
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,  # nonRepudiation
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        # ExtendedKeyUsage: emailProtection + OID Adobe
        .add_extension(
            x509.ExtendedKeyUsage([
                ExtendedKeyUsageOID.EMAIL_PROTECTION,
                ADOBE_PDF_SIGNING_OID,
            ]),
            critical=False,
        )
        # SubjectKeyIdentifier: automático
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(private_key.public_key()),
            critical=False,
        )
        # AuthorityKeyIdentifier: automático (autofirmado → misma clave)
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(private_key.public_key()),
            critical=False,
        )
        .sign(private_key, hashes.SHA256())
    )

    # Guardar clave privada en PEM (sin contraseña — proteger con permisos de archivo)
    print(f"Guardando clave privada en {KEY_PATH}...")
    with open(KEY_PATH, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))
    # Restringir permisos: solo el propietario puede leer
    os.chmod(KEY_PATH, 0o600)

    # Guardar certificado en PEM
    print(f"Guardando certificado en {CERT_PATH}...")
    with open(CERT_PATH, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    # Calcular huella SHA-256 del certificado
    fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    fingerprint_formatted = ":".join(
        fingerprint[i:i+2].upper() for i in range(0, len(fingerprint), 2)
    )

    # Imprimir resumen
    print("\n" + "=" * 60)
    print("✅ CERTIFICADO GENERADO EXITOSAMENTE")
    print("=" * 60)
    print(f"Subject:          {cert.subject.rfc4514_string()}")
    print(f"Serial Number:    {cert.serial_number}")
    print(f"Válido desde:     {cert.not_valid_before_utc.strftime('%d/%m/%Y %H:%M:%S UTC')}")
    print(f"Válido hasta:     {cert.not_valid_after_utc.strftime('%d/%m/%Y %H:%M:%S UTC')}")
    print(f"Huella SHA-256:   {fingerprint_formatted}")
    print("=" * 60)
    print()
    print("⚠️  ADVERTENCIA DE SEGURIDAD:")
    print("   El archivo certs/docubox.key NUNCA debe salir del VPS")
    print("   ni subirse a ningún repositorio.")
    print("   Agregar certs/ al .gitignore.")
    print()
    print("Próximos pasos:")
    print("  1. cp .env.example .env")
    print("  2. Editar .env con tus valores reales")
    print("  3. python signer/server.py")


if __name__ == "__main__":
    generate_certificate()
