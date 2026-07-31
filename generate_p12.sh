#!/bin/bash
# DOCUBOX — Generación de certificado PKCS#12 para firma criptográfica
# Ejecutar UNA SOLA VEZ en tu máquina local
# Requiere: openssl instalado (disponible en Mac/Linux)
#
# Resultado:
#   docubox.key              → clave privada RSA 2048 (NUNCA subir a git)
#   docubox.crt              → certificado X.509 autofirmado
#   docubox.p12              → paquete PKCS#12 (NUNCA subir a git)
#   docubox_p12_base64.txt   → contenido base64 para Supabase Vault

set -e

echo "" echo"╔══════════════════════════════════════════════════════════╗" echo"║   DOCUBOX — Generación de Certificado de Firma Digital   ║" echo"╚══════════════════════════════════════════════════════════╝" echo""

# 1. Clave privada RSA 2048
echo "▶ Generando clave privada RSA 2048..."
openssl genrsa -out docubox.key 2048
echo "  ✓ docubox.key generado"

# 2. Certificado X.509 autofirmado
echo "" echo"▶ Generando certificado X.509 autofirmado..."
openssl req -new -x509 \
  -key docubox.key \
  -out docubox.crt \
  -days 825 \
  -subj "/CN=Docubox CA/O=Docubox/C=MX" -addext"keyUsage=digitalSignature,nonRepudiation,contentCommitment" -addext"extendedKeyUsage=emailProtection,1.2.840.113583.1.1.5" echo"  ✓ docubox.crt generado (válido 825 días)"

# 3. Empaquetar en PKCS#12
echo "" echo"▶ Empaquetando en PKCS#12..."
openssl pkcs12 -export \
  -out docubox.p12 \
  -inkey docubox.key \
  -in docubox.crt \
  -name "Docubox CA" \
  -passout pass:docubox_signing_2025
echo "  ✓ docubox.p12 generado"

# 4. Convertir a base64 para Supabase Vault
echo "" echo"▶ Convirtiendo a base64..."
base64 -i docubox.p12 -o docubox_p12_base64.txt
echo "  ✓ docubox_p12_base64.txt generado"

# 5. Mostrar información del certificado
echo "" echo"══════════════════════════════════════════════════════════" echo"  Información del certificado generado:" echo"══════════════════════════════════════════════════════════"
openssl x509 -in docubox.crt -noout -subject -issuer -dates -fingerprint -sha256
echo "" echo"══════════════════════════════════════════════════════════" echo"  PASOS SIGUIENTES:" echo"══════════════════════════════════════════════════════════" echo"" echo"  1. Copiar el contenido de docubox_p12_base64.txt" echo"     → Supabase Dashboard → Settings → Vault → New Secret" echo"     → Nombre: DOCUBOX_P12_BASE64" echo"     → Valor: (pegar el contenido del archivo)" echo"" echo"  2. Crear otro secret en Supabase Vault:" echo"     → Nombre: DOCUBOX_P12_PASSWORD" echo"     → Valor: docubox_signing_2025" echo"" echo"  3. Agregar al .gitignore:" echo"     docubox.key" echo"     docubox.p12" echo"     docubox_p12_base64.txt" echo"" echo"  ⚠️  IMPORTANTE: docubox.key y docubox.p12 contienen" echo"     la clave privada. NUNCA subirlos a ningún repositorio." echo"" echo"══════════════════════════════════════════════════════════"
