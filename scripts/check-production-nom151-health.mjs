const token = process.env.DOCUBOX_INTERNAL_CERTIFICATION_TOKEN;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://docubox-delta.vercel.app';

if (!token) {
  throw new Error('PRODUCTION_INTERNAL_TOKEN_NOT_AVAILABLE');
}

const response = await fetch(`${siteUrl.replace(/\/$/, '')}/api/internal/crypto/nom151-health`, {
  headers: { 'x-docubox-internal-token': token },
});
const body = await response.json();

if (!response.ok) {
  throw new Error(`NOM151_HEALTH_HTTP_${response.status}_${body.code || 'UNKNOWN'}`);
}

const health = body.health;
console.info(
  JSON.stringify(
    {
      ready: health.ready,
      productionReady: health.productionReady,
      provider: health.provider,
      environment: health.environment,
      environmentExplicit: health.environmentExplicit,
      trustBundleLoaded: health.trustBundleLoaded,
      trustBundleVersion: health.trustBundleVersion,
      rootTrusted: health.rootTrusted,
      certificatesWithinValidity: health.certificatesWithinValidity,
      environmentMismatch: health.environmentMismatch,
      missingCount: health.missing?.length || 0,
      errorCount: health.errors?.length || 0,
      failureCode: health.failureCode,
    },
    null,
    2
  )
);
