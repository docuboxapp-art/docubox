# DOCUBOX — Servidor de Firma PAdES

Módulo Python para firma criptográfica PAdES B-T con pyHanko.
Se ejecuta en el VPS de Hostinger y recibe PDFs desde la Edge Function
`sign-pdf-vps` de Supabase para aplicarles firma criptográfica que
Adobe Acrobat puede validar nativamente.

---

## SETUP INICIAL (ejecutar una sola vez)

```bash
# 1. Instalar dependencias
pip install -r requirements.txt

# 2. Generar certificado X.509 (solo la primera vez)
python generate_cert.py

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores reales

# 4. Iniciar el servidor
python signer/server.py
```

---

## VERIFICAR QUE FUNCIONA

```bash
curl http://localhost:8001/health
```

Respuesta esperada:
```json
{
  "status": "ok",
  "certificate_loaded": true,
  "certificate_subject": "CN=Docubox CA,O=Docubox,C=MX",
  "certificate_expires_in_days": 825,
  "tsa_url": "http://timestamp.digicert.com",
  "pyhanko_version": "..."
}
```

---

## ESTRUCTURA DE ARCHIVOS

```
generate_cert.py     ← ejecutar una sola vez para generar el certificado
requirements.txt     ← dependencias Python
.env                 ← variables de entorno (NO subir a git)
.env.example         ← plantilla de variables de entorno
.gitignore           ← excluye certs/ y .env del repositorio

certs/
  docubox.key        ← CLAVE PRIVADA — NUNCA subir a git ni compartir
  docubox.crt        ← Certificado X.509 público

signer/
  server.py          ← punto de entrada del servidor HTTP
  cert_loader.py     ← carga el certificado en RAM
  appearance.py      ← diseño visual del campo de firma
  pades_core.py      ← lógica principal de firma PAdES
```

---

## ENDPOINTS

### POST /sign
Aplica firma PAdES B-T al PDF recibido.

**Headers requeridos:**
- `X-VPS-Token: {VPS_SECRET_TOKEN}`
- `Content-Type: multipart/form-data`

**Campos del formulario:**
| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| file | bytes | ✓ | PDF a firmar |
| document_id | string | ✓ | ID del documento en Supabase |
| signer_name | string | ✓ | Nombre completo del firmante |
| signer_email | string | ✓ | Correo del firmante |
| reason | string | ✓ | Razón de la firma |
| location | string | — | Ubicación (default: México) |
| ip_address | string | ✓ | IP del firmante |
| page_number | int | — | Página del campo (default: -2 = penúltima) |
| field_x | float | — | Posición X del campo |
| field_y | float | — | Posición Y del campo |
| signature_image | bytes | — | PNG de firma autógrafa |
| signing_session_id | string | — | ID de sesión en Supabase |

**Respuesta:** PDF firmado como bytes con headers:
- `X-Signed-Hash`: SHA-256 del PDF firmado
- `X-Original-Hash`: SHA-256 del PDF original
- `X-Field-Name`: Nombre del campo de firma
- `X-Signed-At`: Fecha y hora ISO8601
- `X-Signature-Level`: PAdES-B-T

### POST /verify
Verifica las firmas de un PDF.

**Headers requeridos:** `X-VPS-Token`

**Campos:** `file` (PDF)

**Respuesta JSON:**
```json
{
  "valid": true,
  "total_signatures": 1,
  "signatures": [...]
}
```

### GET /health
Estado del servidor (sin autenticación).

---

## PARA PRODUCCIÓN EN VPS HOSTINGER

### Con systemd (recomendado)

Crear `/etc/systemd/system/docubox-signing.service`:

```ini
[Unit]
Description=DOCUBOX Signing Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/ruta/al/proyecto
ExecStart=/usr/bin/python3 signer/server.py
Restart=always
RestartSec=5
EnvironmentFile=/ruta/al/proyecto/.env

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable docubox-signing
systemctl start docubox-signing
systemctl status docubox-signing
```

### Con supervisor

```ini
[program:docubox-signing]
command=python3 signer/server.py
directory=/ruta/al/proyecto
autostart=true
autorestart=true
stderr_logfile=/var/log/docubox-signing.err.log
stdout_logfile=/var/log/docubox-signing.out.log
```

---

## SEGURIDAD

- `certs/docubox.key` **NUNCA** debe salir del VPS
- **NUNCA** subir `certs/` ni `.env` a ningún repositorio
- El token `VPS_SECRET_TOKEN` debe tener al menos 32 caracteres aleatorios
- Generar token seguro: `openssl rand -base64 32`
- Restringir acceso al puerto 8001 solo desde las IPs de Supabase Edge Functions

---

## FLUJO DEL PROYECTO

```
Frontend → seal-pdf (Edge Function)
         → Genera constancia visual en el PDF
         → Guarda sealed.pdf en Storage

Frontend → sign-pdf-vps (Edge Function)
         → Descarga sealed.pdf de Storage
         → Envía al VPS (este servidor)
         → VPS aplica firma PAdES B-T
         → Guarda signed.pdf en Storage
         → Retorna PDF firmado al frontend
```
