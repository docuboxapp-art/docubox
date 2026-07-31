import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

/**
 * POST /api/efirma/validate-key
 *
 * Validates a SAT .key file password by attempting to decrypt the private key.
 * The password is NEVER stored, logged, or returned.
 *
 * Body: multipart/form-data
 *   - keyFile: the .key binary file
 *   - password: the private key password (handled in memory only)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const keyFile = formData.get('keyFile') as File | null;
    const password = formData.get('password') as string | null;

    // ── Validations ──────────────────────────────────────────────────────────
    if (!keyFile) {
      return NextResponse.json({
        success: false,
        isPasswordValid: false,
        message: 'No se proporcionó el archivo .key.',
        errorCode: 'MISSING_KEY_FILE',
      }, { status: 400 });
    }

    if (!keyFile.name.toLowerCase().endsWith('.key')) {
      return NextResponse.json({
        success: false,
        isPasswordValid: false,
        message: 'El archivo proporcionado no es un archivo .key válido.',
        errorCode: 'INVALID_FILE_TYPE',
      }, { status: 400 });
    }

    if (!password || password.trim() === '') {
      return NextResponse.json({
        success: false,
        isPasswordValid: false,
        message: 'La contraseña no puede estar vacía.',
        errorCode: 'EMPTY_PASSWORD',
      }, { status: 400 });
    }

    // ── Read file bytes ───────────────────────────────────────────────────────
    const arrayBuffer = await keyFile.arrayBuffer();
    const keyBuffer = Buffer.from(arrayBuffer);

    if (keyBuffer.length < 10) {
      return NextResponse.json({
        success: false,
        isPasswordValid: false,
        message: 'El archivo .key está vacío o corrupto.',
        errorCode: 'CORRUPTED_FILE',
      }, { status: 400 });
    }

    // ── Attempt decryption ────────────────────────────────────────────────────
    // SAT .key files are PKCS#8 encrypted private keys (DER format).
    // We attempt to import the key using Node.js crypto.
    // If decryption succeeds → password is correct.
    // If it throws → password is wrong or file is invalid.

    let decryptionSuccess = false;
    let errorCode = 'INVALID_KEY_PASSWORD';
    let errorMessage = 'La contraseña es incorrecta o la llave privada no es válida.';

    try {
      // Try as PKCS#8 encrypted DER (most common SAT format)
      crypto.createPrivateKey({
        key: keyBuffer,
        format: 'der',
        type: 'pkcs8',
        passphrase: password,
      });
      decryptionSuccess = true;
    } catch (pkcs8Error: unknown) {
      // Try as PEM in case the file is PEM-encoded
      try {
        const pemContent = keyBuffer.toString('utf8');
        if (pemContent.includes('-----BEGIN')) {
          crypto.createPrivateKey({
            key: pemContent,
            format: 'pem',
            passphrase: password,
          });
          decryptionSuccess = true;
        } else {
          // Not PEM, check if the error indicates wrong password vs bad format
          const errMsg = pkcs8Error instanceof Error ? pkcs8Error.message : String(pkcs8Error);
          if (
            errMsg.includes('bad decrypt') ||
            errMsg.includes('wrong password') ||
            errMsg.includes('mac verify failure') ||
            errMsg.includes('bad password') ||
            errMsg.includes('PKCS12') ||
            errMsg.includes('password') ||
            errMsg.includes('decrypt')
          ) {
            errorCode = 'INVALID_KEY_PASSWORD';
            errorMessage = 'La contraseña es incorrecta o la llave privada no es válida.';
          } else if (
            errMsg.includes('unsupported') ||
            errMsg.includes('unknown') ||
            errMsg.includes('not supported')
          ) {
            errorCode = 'UNSUPPORTED_FORMAT';
            errorMessage = 'El formato de la llave privada no es compatible. Verifica que sea un archivo .key del SAT.';
          } else if (
            errMsg.includes('asn1') ||
            errMsg.includes('parse') ||
            errMsg.includes('encoding') ||
            errMsg.includes('header too long') ||
            errMsg.includes('bad end line')
          ) {
            errorCode = 'PARSE_ERROR';
            errorMessage = 'No se pudo procesar el archivo. El archivo .key podría estar corrupto o dañado.';
          } else {
            errorCode = 'INVALID_KEY_PASSWORD';
            errorMessage = 'La contraseña es incorrecta o la llave privada no es válida.';
          }
        }
      } catch (pemError: unknown) {
        const errMsg = pemError instanceof Error ? pemError.message : String(pemError);
        if (
          errMsg.includes('bad decrypt') ||
          errMsg.includes('wrong password') ||
          errMsg.includes('mac verify failure') ||
          errMsg.includes('bad password') ||
          errMsg.includes('password') ||
          errMsg.includes('decrypt')
        ) {
          errorCode = 'INVALID_KEY_PASSWORD';
          errorMessage = 'La contraseña es incorrecta o la llave privada no es válida.';
        } else {
          errorCode = 'INVALID_KEY_PASSWORD';
          errorMessage = 'La contraseña es incorrecta o la llave privada no es válida.';
        }
      }
    }

    if (decryptionSuccess) {
      return NextResponse.json({
        success: true,
        isPasswordValid: true,
        message: 'La llave privada fue descifrada correctamente.',
      });
    }

    return NextResponse.json({
      success: false,
      isPasswordValid: false,
      message: errorMessage,
      errorCode,
    });
  } catch {
    return NextResponse.json({
      success: false,
      isPasswordValid: false,
      message: 'Error interno al procesar el archivo. Intenta nuevamente.',
      errorCode: 'INTERNAL_ERROR',
    }, { status: 500 });
  }
}
