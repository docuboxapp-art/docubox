// DOCUBOX — generate-docubox-cert Edge Function
// Genera certificado X.509 RSA-2048 autofirmado usando Web Crypto API + @peculiar/x509
// Empaqueta en PKCS#12 y guarda en Supabase Vault como DOCUBOX_P12_BASE64 y DOCUBOX_P12_PASSWORD
// Ejecutar UNA SOLA VEZ desde el dashboard de administración.
// La clave privada NUNCA sale de esta función ni se retorna en ninguna respuesta.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as x509 from 'https://esm.sh/@peculiar/x509@1.9.7';


import * as pkcs8 from 'https://esm.sh/@peculiar/asn1-pkcs8@2.3.13';


declare const Deno: {
  env: { get(key: string): string | undefined }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const P12_PASSWORD = 'docubox_signing_2025'

// ── Utilidades de codificación ────────────────────────────────────────────────

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function concatBuffers(...buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset)
    offset += buf.byteLength
  }
  return result.buffer
}

// ── Construcción manual de PKCS#12 ───────────────────────────────────────────
// Implementación usando ASN.1 primitivo para máxima compatibilidad con Deno

function encodeLength(len: number): Uint8Array {
  if (len < 128) return new Uint8Array([len])
  if (len < 256) return new Uint8Array([0x81, len])
  return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff])
}

function encodeTLV(tag: number, value: Uint8Array): Uint8Array {
  const lenBytes = encodeLength(value.length)
  const result = new Uint8Array(1 + lenBytes.length + value.length)
  result[0] = tag
  result.set(lenBytes, 1)
  result.set(value, 1 + lenBytes.length)
  return result
}

function encodeSequence(content: Uint8Array): Uint8Array {
  return encodeTLV(0x30, content)
}

function encodeSet(content: Uint8Array): Uint8Array {
  return encodeTLV(0x31, content)
}

function encodeOctetString(data: Uint8Array): Uint8Array {
  return encodeTLV(0x04, data)
}

function encodeInteger(value: number): Uint8Array {
  return encodeTLV(0x02, new Uint8Array([value]))
}

function encodeOID(oidStr: string): Uint8Array {
  const parts = oidStr.split('.').map(Number)
  const bytes: number[] = [40 * parts[0] + parts[1]]
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i]
    const chunk: number[] = []
    chunk.push(val & 0x7f)
    val >>= 7
    while (val > 0) {
      chunk.unshift((val & 0x7f) | 0x80)
      val >>= 7
    }
    bytes.push(...chunk)
  }
  return encodeTLV(0x06, new Uint8Array(bytes))
}

function encodeUTF8String(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str)
  return encodeTLV(0x0c, encoded)
}

function encodeBMPString(str: string): Uint8Array {
  const bytes: number[] = []
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    bytes.push((code >> 8) & 0xff, code & 0xff)
  }
  return encodeTLV(0x1e, new Uint8Array(bytes))
}

function encodeContextTag(tag: number, content: Uint8Array, constructed = true): Uint8Array {
  const tagByte = (constructed ? 0xa0 : 0x80) | tag
  return encodeTLV(tagByte, content)
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ── Derivación de clave PBKDF2 para PKCS#12 ──────────────────────────────────

async function pbkdf2DeriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  keyLen: number,
  hashAlgo: string
): Promise<Uint8Array> {
  const enc = new TextEncoder()
  // PKCS#12 usa codificación BMPString para la contraseña
  const pwBytes: number[] = []
  for (let i = 0; i < password.length; i++) {
    pwBytes.push(0, password.charCodeAt(i))
  }
  pwBytes.push(0, 0) // null terminator BMP

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(pwBytes),
    'PBKDF2',
    false,
    ['deriveBits']
  )

  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: hashAlgo,
    },
    keyMaterial,
    keyLen * 8
  )

  return new Uint8Array(derived)
}

// ── Cifrado AES-256-CBC para PKCS#12 ─────────────────────────────────────────

async function encryptAES256CBC(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'AES-CBC' },
    false,
    ['encrypt']
  )
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    data
  )
  return new Uint8Array(encrypted)
}

// ── HMAC-SHA256 para MAC de PKCS#12 ──────────────────────────────────────────

async function hmacSHA256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data)
  return new Uint8Array(sig)
}

// ── Construcción del PKCS#12 ──────────────────────────────────────────────────

async function buildPKCS12(
  privateKeyDer: ArrayBuffer,
  certDer: ArrayBuffer,
  password: string,
  friendlyName: string
): Promise<Uint8Array> {
  const iterations = 2048
  const saltLen = 16

  // Generar sales aleatorias
  const keySalt = crypto.getRandomValues(new Uint8Array(saltLen))
  const certSalt = crypto.getRandomValues(new Uint8Array(saltLen))
  const macSalt = crypto.getRandomValues(new Uint8Array(saltLen))
  const keyIV = crypto.getRandomValues(new Uint8Array(16))

  // Derivar clave AES-256 para cifrar la clave privada
  const aesKey = await pbkdf2DeriveKey(password, keySalt, iterations, 32, 'SHA-256')

  // Cifrar clave privada PKCS#8
  const pkcs8Bytes = new Uint8Array(privateKeyDer)
  const encryptedKey = await encryptAES256CBC(pkcs8Bytes, aesKey, keyIV)

  // ── SafeBag para clave privada cifrada ────────────────────────────────────
  // OID: pkcs-12-pkcs-8ShroudedKeyBag = 1.2.840.113549.1.12.10.1.2
  const shroudedKeyBagOID = encodeOID('1.2.840.113549.1.12.10.1.2')

  // AlgorithmIdentifier para AES-256-CBC con PBKDF2
  // OID PBKDF2: 1.2.840.113549.1.5.12
  // OID AES-256-CBC: 2.16.840.1.101.3.4.1.42
  // OID PBES2: 1.2.840.113549.1.5.13
  const pbkdf2OID = encodeOID('1.2.840.113549.1.5.12')
  const aesCBCOID = encodeOID('2.16.840.1.101.3.4.1.42')
  const pbes2OID = encodeOID('1.2.840.113549.1.5.13')
  const hmacSHA256OID = encodeOID('1.2.840.113549.2.9')

  // PBKDF2 params
  const pbkdf2Params = encodeSequence(concat(
    encodeOctetString(keySalt),
    encodeInteger(iterations),
    encodeSequence(concat(hmacSHA256OID, encodeSequence(new Uint8Array(0))))
  ))

  // AES-CBC params (IV)
  const aesCBCParams = encodeOctetString(keyIV)

  // PBES2 params
  const pbes2Params = encodeSequence(concat(
    encodeSequence(concat(pbkdf2OID, pbkdf2Params)),
    encodeSequence(concat(aesCBCOID, aesCBCParams))
  ))

  const encryptionAlgorithm = encodeSequence(concat(pbes2OID, pbes2Params))

  // EncryptedPrivateKeyInfo
  const encryptedPrivateKeyInfo = encodeSequence(concat(
    encryptionAlgorithm,
    encodeOctetString(encryptedKey)
  ))

  // Atributo friendlyName para la clave
  const friendlyNameAttrKey = encodeSequence(concat(
    encodeOID('1.2.840.113549.1.9.20'),
    encodeSet(encodeBMPString(friendlyName))
  ))

  const shroudedKeyBag = encodeSequence(concat(
    shroudedKeyBagOID,
    encodeContextTag(0, encryptedPrivateKeyInfo),
    encodeSet(friendlyNameAttrKey)
  ))

  // ── SafeBag para certificado ──────────────────────────────────────────────
  // OID: pkcs-12-certBag = 1.2.840.113549.1.12.10.1.3
  const certBagOID = encodeOID('1.2.840.113549.1.12.10.1.3')
  // OID: x509Certificate = 1.2.840.113549.1.9.22.1
  const x509CertOID = encodeOID('1.2.840.113549.1.9.22.1')

  const certValue = encodeContextTag(0,
    encodeSequence(concat(
      x509CertOID,
      encodeContextTag(0, encodeOctetString(new Uint8Array(certDer)))
    ))
  )

  const friendlyNameAttrCert = encodeSequence(concat(
    encodeOID('1.2.840.113549.1.9.20'),
    encodeSet(encodeBMPString(friendlyName))
  ))

  const certBag = encodeSequence(concat(
    certBagOID,
    certValue,
    encodeSet(friendlyNameAttrCert)
  ))

  // ── SafeContents ──────────────────────────────────────────────────────────
  const safeContentsKey = encodeSequence(shroudedKeyBag)
  const safeContentsCert = encodeSequence(certBag)

  // ContentInfo para clave (data sin cifrar — ya está cifrada internamente)
  const dataOID = encodeOID('1.2.840.113549.1.7.1')

  const keyContentInfo = encodeSequence(concat(
    dataOID,
    encodeContextTag(0, encodeOctetString(safeContentsKey))
  ))

  const certContentInfo = encodeSequence(concat(
    dataOID,
    encodeContextTag(0, encodeOctetString(safeContentsCert))
  ))

  // AuthenticatedSafe = SEQUENCE OF ContentInfo
  const authenticatedSafe = encodeSequence(concat(keyContentInfo, certContentInfo))

  // ── MAC ───────────────────────────────────────────────────────────────────
  const macKey = await pbkdf2DeriveKey(password, macSalt, iterations, 32, 'SHA-256')
  const mac = await hmacSHA256(macKey, authenticatedSafe)

  // DigestInfo para MAC
  const sha256OID = encodeOID('2.16.840.1.101.3.4.2.1')
  const digestInfo = encodeSequence(concat(
    encodeSequence(concat(sha256OID, new Uint8Array([0x05, 0x00]))),
    encodeOctetString(mac)
  ))

  // MacData
  const macData = encodeSequence(concat(
    digestInfo,
    encodeOctetString(macSalt),
    encodeInteger(iterations)
  ))

  // ── PFX (PKCS#12) ─────────────────────────────────────────────────────────
  const pfx = encodeSequence(concat(
    encodeInteger(3), // version
    encodeSequence(concat(
      dataOID,
      encodeContextTag(0, encodeOctetString(authenticatedSafe))
    )),
    macData
  ))

  return pfx
}

// ── Handler principal ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── Autenticación: solo service role key ──────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!authHeader.includes(serviceRoleKey)) {
      return new Response(
        JSON.stringify({ error: 'No autorizado. Se requiere service role key.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // ── Verificar si ya existen los secrets en Vault ──────────────────────────
    const { data: existingSecrets } = await supabase
      .from('vault.secrets')
      .select('name')
      .in('name', ['DOCUBOX_P12_BASE64', 'DOCUBOX_P12_PASSWORD'])

    if (existingSecrets && existingSecrets.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          already_exists: true,
          message:
            'El certificado ya existe en Vault. Para regenerarlo elimina primero los secrets ' +
            'DOCUBOX_P12_BASE64 y DOCUBOX_P12_PASSWORD en Supabase Dashboard → Settings → Vault.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ── PASO 1: Generar par de claves RSA-2048 con Web Crypto ─────────────────
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    )

    // ── PASO 2: Crear certificado X.509 con @peculiar/x509 ───────────────────
    const serialNumber = crypto.randomUUID().replace(/-/g, '')
    const notBefore = new Date()
    const notAfter = new Date(Date.now() + 825 * 24 * 60 * 60 * 1000)

    const cert = await x509.X509CertificateGenerator.createSelfSigned({
      serialNumber,
      name: 'CN=Docubox CA, O=Docubox, C=MX',
      notBefore,
      notAfter,
      signingAlgorithm: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      keys: keyPair,
      extensions: [
        new x509.KeyUsagesExtension(
          x509.KeyUsageFlags.digitalSignature |
          x509.KeyUsageFlags.nonRepudiation |
          x509.KeyUsageFlags.contentCommitment,
          true
        ),
        new x509.ExtendedKeyUsageExtension([
          '1.3.6.1.5.5.7.3.4',    // emailProtection
          '1.2.840.113583.1.1.5', // Adobe PDF signing
        ], false),
        new x509.BasicConstraintsExtension(false, 0, true),
        await x509.SubjectKeyIdentifierExtension.create(keyPair.publicKey),
      ],
    })

    // ── PASO 3: Exportar clave privada como PKCS#8 ────────────────────────────
    const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

    // ── PASO 4: Empaquetar en PKCS#12 ─────────────────────────────────────────
    const certDer = cert.rawData
    const p12Bytes = await buildPKCS12(
      privateKeyBuffer,
      certDer,
      P12_PASSWORD,
      'Docubox CA'
    )

    // ── PASO 5: Convertir P12 a base64 ────────────────────────────────────────
    const p12Base64 = bufferToBase64(p12Bytes.buffer)

    // ── PASO 6: Guardar en Supabase Vault ─────────────────────────────────────
    // Intentar con vault.create_secret RPC primero
    let vaultSaved = false
    const vaultErrors: string[] = []

    try {
      const { error: err1 } = await supabase.rpc('vault_create_secret', {
        secret: p12Base64,
        name: 'DOCUBOX_P12_BASE64',
        description: 'Certificado P12 Docubox CA para firma PAdES',
      })
      if (err1) vaultErrors.push(`vault_create_secret P12: ${err1.message}`)

      const { error: err2 } = await supabase.rpc('vault_create_secret', {
        secret: P12_PASSWORD,
        name: 'DOCUBOX_P12_PASSWORD',
        description: 'Password del certificado P12 Docubox CA',
      })
      if (err2) vaultErrors.push(`vault_create_secret PWD: ${err2.message}`)

      if (!err1 && !err2) vaultSaved = true
    } catch (rpcErr) {
      vaultErrors.push(`RPC error: ${(rpcErr as Error).message}`)
    }

    // Fallback: insertar directamente en vault.secrets si el RPC falla
    if (!vaultSaved) {
      try {
        const { error: insertErr1 } = await supabase
          .schema('vault')
          .from('secrets')
          .insert({
            secret: p12Base64,
            name: 'DOCUBOX_P12_BASE64',
            description: 'Certificado P12 Docubox CA para firma PAdES',
          })
        if (insertErr1) vaultErrors.push(`insert P12: ${insertErr1.message}`)

        const { error: insertErr2 } = await supabase
          .schema('vault')
          .from('secrets')
          .insert({
            secret: P12_PASSWORD,
            name: 'DOCUBOX_P12_PASSWORD',
            description: 'Password del certificado P12 Docubox CA',
          })
        if (insertErr2) vaultErrors.push(`insert PWD: ${insertErr2.message}`)

        if (!insertErr1 && !insertErr2) vaultSaved = true
      } catch (insertErr) {
        vaultErrors.push(`Insert fallback error: ${(insertErr as Error).message}`)
      }
    }

    // ── PASO 7: Retornar confirmación (NUNCA el P12 ni la clave) ─────────────
    return new Response(
      JSON.stringify({
        success: true,
        certificate: {
          subject: 'CN=Docubox CA, O=Docubox, C=MX',
          serial_number: serialNumber,
          valid_from: notBefore.toISOString(),
          valid_until: notAfter.toISOString(),
          key_algorithm: 'RSA-2048',
          signature_algorithm: 'SHA256withRSA',
          extensions: [
            'KeyUsage: digitalSignature, nonRepudiation, contentCommitment',
            'ExtendedKeyUsage: emailProtection, Adobe PDF (1.2.840.113583.1.1.5)',
            'BasicConstraints: CA:FALSE',
            'SubjectKeyIdentifier: presente',
          ],
        },
        vault_secrets_saved: vaultSaved
          ? ['DOCUBOX_P12_BASE64', 'DOCUBOX_P12_PASSWORD']
          : [],
        vault_saved: vaultSaved,
        vault_errors: vaultErrors.length > 0 ? vaultErrors : undefined,
        message: vaultSaved
          ? 'Certificado generado y guardado en Vault. La Edge Function seal-pdf puede usarlo inmediatamente.'
          : 'Certificado generado correctamente. Hubo errores al guardar en Vault — revisa los vault_errors y guarda manualmente los secrets DOCUBOX_P12_BASE64 y DOCUBOX_P12_PASSWORD en Supabase Dashboard → Settings → Vault.',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('generate-docubox-cert error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Error al generar el certificado',
        details: (error as Error).message,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
