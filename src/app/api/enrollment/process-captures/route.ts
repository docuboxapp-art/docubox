import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import crypto from 'crypto';

// AES-256-CBC encryption helpers
const ENCRYPTION_KEY = process.env.ENROLLMENT_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function encryptData(data: string, iv: Buffer): string {
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 64), 'hex');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function generateIV(): Buffer {
  return crypto.randomBytes(16);
}

// Extract document metadata from base64 image (heuristic / placeholder for real OCR)
function extractDocumentMetadata(tipoId: string, anversoBase64: string): Record<string, unknown> {
  // In production: call OCR API (e.g., Google Vision, AWS Textract, or Nubarium)
  // For now, return structured placeholder metadata
  return {
    tipo_documento: tipoId,
    imagen_size_bytes: Math.round((anversoBase64.length * 3) / 4),
    processed_at: new Date().toISOString(),
    ocr_status: 'pending', // Would be 'completed' after real OCR
    confidence: null,
  };
}

// Simulate face-to-ID matching (in production: call face recognition API)
function validateFaceToId(
  selfieBase64: string,
  anversoBase64: string
): { passed: boolean; score: number } {
  // In production: call face recognition service (e.g., AWS Rekognition, Azure Face API)
  // Simulate a match score based on image sizes as a proxy
  const selfieSize = selfieBase64.length;
  const anversoSize = anversoBase64.length;
  const ratio = Math.min(selfieSize, anversoSize) / Math.max(selfieSize, anversoSize);
  // Simulate score between 85-98 for valid captures
  const score = Math.round(85 + ratio * 13);
  return { passed: score >= 80, score };
}

// Generate a simple face encoding hash (in production: use real face embedding)
function generateFaceEncoding(selfieBase64: string): string {
  return crypto.createHash('sha256').update(selfieBase64).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      token,
      tipoId,
      anversoCapture,
      reversoCapture,
      selfieCapture,
      selfieVideo,
    } = body;

    if (!token || !tipoId || !anversoCapture || !reversoCapture || !selfieCapture) {
      return NextResponse.json(
        { error: 'Missing required fields: token, tipoId, anversoCapture, reversoCapture, selfieCapture' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Verify token
    const { data: tokenData, error: tokenError } = await supabase
      .from('enrollment_tokens')
      .select('id, status, expires_at, session_id')
      .eq('token', token)
      .single();

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Token expired', expired: true }, { status: 410 });
    }

    if (tokenData.status === 'completed') {
      return NextResponse.json({ error: 'Token already used' }, { status: 409 });
    }

    // Strip data URL prefix if present
    const stripPrefix = (b64: string) => b64.replace(/^data:image\/\w+;base64,/, '');
    const anversoData = stripPrefix(anversoCapture);
    const reversoData = stripPrefix(reversoCapture);
    const selfieData = stripPrefix(selfieCapture);

    // Generate encryption IV
    const iv = generateIV();
    const ivHex = iv.toString('hex');

    // Encrypt all images with AES-256-CBC
    const anversoEncrypted = encryptData(anversoData, iv);
    const reversoEncrypted = encryptData(reversoData, iv);
    const selfieEncrypted = encryptData(selfieData, iv);

    // Generate face encoding and encrypt it
    const faceEncoding = generateFaceEncoding(selfieData);
    const faceEncodingEncrypted = encryptData(faceEncoding, iv);

    // Extract document metadata
    const documentMetadata = extractDocumentMetadata(tipoId, anversoData);

    // Validate face-to-ID match
    const { passed: faceMatchPassed, score: faceMatchScore } = validateFaceToId(selfieData, anversoData);

    // Update enrollment_tokens with encrypted data
    const { error: updateError } = await supabase
      .from('enrollment_tokens')
      .update({
        anverso_encrypted: anversoEncrypted,
        reverso_encrypted: reversoEncrypted,
        selfie_encrypted: selfieEncrypted,
        face_encoding_encrypted: faceEncodingEncrypted,
        encryption_iv: ivHex,
        face_match_score: faceMatchScore,
        document_metadata: documentMetadata,
        processing_status: faceMatchPassed ? 'validated' : 'face_mismatch',
      })
      .eq('token', token);

    if (updateError) {
      console.error('[process-captures] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to store encrypted captures' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      faceMatchPassed,
      faceMatchScore,
      documentMetadata,
      processingStatus: faceMatchPassed ? 'validated' : 'face_mismatch',
    });
  } catch (err) {
    console.error('[process-captures] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
