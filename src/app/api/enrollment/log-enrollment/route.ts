import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';

const supabaseAdmin = createSupabaseAdmin(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

function parseUserAgent(ua: string): {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: string;
} {
  let browser = 'Unknown';
  let browserVersion = '';
  let os = 'Unknown';
  let osVersion = '';
  let deviceType = 'desktop';

  if (/bot|crawl|spider|slurp|mediapartners/i.test(ua)) {
    deviceType = 'bot';
  } else if (/tablet|ipad|playbook|silk/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(ua)) {
    deviceType = 'mobile';
  }

  if (/windows nt 10/i.test(ua)) { os = 'Windows'; osVersion = '10'; }
  else if (/windows nt 11/i.test(ua)) { os = 'Windows'; osVersion = '11'; }
  else if (/windows nt 6\.3/i.test(ua)) { os = 'Windows'; osVersion = '8.1'; }
  else if (/windows nt 6\.2/i.test(ua)) { os = 'Windows'; osVersion = '8'; }
  else if (/windows nt 6\.1/i.test(ua)) { os = 'Windows'; osVersion = '7'; }
  else if (/windows/i.test(ua)) { os = 'Windows'; }
  else if (/mac os x ([\d_]+)/i.test(ua)) {
    os = 'macOS';
    const m = ua.match(/mac os x ([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, '.') : '';
  } else if (/android ([\d.]+)/i.test(ua)) {
    os = 'Android';
    const m = ua.match(/android ([\d.]+)/i);
    osVersion = m ? m[1] : '';
  } else if (/iphone os ([\d_]+)/i.test(ua)) {
    os = 'iOS';
    const m = ua.match(/iphone os ([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, '.') : '';
  } else if (/ipad.*os ([\d_]+)/i.test(ua)) {
    os = 'iPadOS';
    const m = ua.match(/ipad.*os ([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, '.') : '';
  } else if (/linux/i.test(ua)) { os = 'Linux'; }

  if (/edg\/([\d.]+)/i.test(ua)) {
    browser = 'Edge';
    const m = ua.match(/edg\/([\d.]+)/i);
    browserVersion = m ? m[1] : '';
  } else if (/opr\/([\d.]+)/i.test(ua) || /opera\/([\d.]+)/i.test(ua)) {
    browser = 'Opera';
    const m = ua.match(/(?:opr|opera)\/([\d.]+)/i);
    browserVersion = m ? m[1] : '';
  } else if (/chrome\/([\d.]+)/i.test(ua) && !/chromium/i.test(ua)) {
    browser = 'Chrome';
    const m = ua.match(/chrome\/([\d.]+)/i);
    browserVersion = m ? m[1] : '';
  } else if (/firefox\/([\d.]+)/i.test(ua)) {
    browser = 'Firefox';
    const m = ua.match(/firefox\/([\d.]+)/i);
    browserVersion = m ? m[1] : '';
  } else if (/safari\/([\d.]+)/i.test(ua) && !/chrome/i.test(ua)) {
    browser = 'Safari';
    const m = ua.match(/version\/([\d.]+)/i);
    browserVersion = m ? m[1] : '';
  } else if (/msie ([\d.]+)/i.test(ua) || /trident.*rv:([\d.]+)/i.test(ua)) {
    browser = 'Internet Explorer';
    const m = ua.match(/(?:msie |rv:)([\d.]+)/i);
    browserVersion = m ? m[1] : '';
  }

  return { browser, browserVersion, os, osVersion, deviceType };
}

async function getGeoFromIP(ip: string) {
  const defaultGeo = {
    country: 'Unknown', countryCode: '', region: '', city: 'Unknown',
    latitude: null as number | null, longitude: null as number | null,
    timezone: '', isp: '', neighborhood: '', postcode: '', place_name: '',
  };

  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return { ...defaultGeo, city: 'Local/Private Network' };
  }

  try {
    const ipRes = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!ipRes.ok) return defaultGeo;
    const ipData = await ipRes.json();
    if (ipData.status !== 'success') return defaultGeo;

    const baseGeo = {
      ...defaultGeo,
      country: ipData.country || 'Unknown',
      countryCode: ipData.countryCode || '',
      region: ipData.regionName || '',
      city: ipData.city || 'Unknown',
      latitude: ipData.lat ?? null,
      longitude: ipData.lon ?? null,
      timezone: ipData.timezone || '',
      isp: ipData.isp || '',
    };

    if (MAPBOX_TOKEN && baseGeo.latitude !== null && baseGeo.longitude !== null) {
      try {
        const mapboxRes = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${baseGeo.longitude},${baseGeo.latitude}.json?types=neighborhood,postcode,place,region,country&language=es&access_token=${MAPBOX_TOKEN}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (mapboxRes.ok) {
          const mapboxData = await mapboxRes.json();
          if (mapboxData.features && mapboxData.features.length > 0) {
            for (const feature of mapboxData.features) {
              if (feature.place_type?.includes('neighborhood') && !baseGeo.neighborhood) {
                baseGeo.neighborhood = feature.text || '';
              }
              if (feature.place_type?.includes('postcode') && !baseGeo.postcode) {
                baseGeo.postcode = feature.text || '';
              }
            }
            baseGeo.place_name = mapboxData.features[0]?.place_name || '';
          }
        }
      } catch {
        // Mapbox enrichment failed — use base geo only
      }
    }

    return baseGeo;
  } catch {
    return defaultGeo;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { enrollmentToken, userAgent } = body;

    if (!enrollmentToken) {
      return NextResponse.json({ error: 'enrollmentToken requerido' }, { status: 400 });
    }

    // Extract real IP from headers
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfIp = request.headers.get('cf-connecting-ip');
    const ipAddress = cfIp || realIp || (forwarded ? forwarded.split(',')[0].trim() : null) || '127.0.0.1';

    // Parse user agent
    const ua = userAgent || request.headers.get('user-agent') || '';
    const { browser, browserVersion, os, osVersion, deviceType } = parseUserAgent(ua);

    // Get geolocation
    const geo = await getGeoFromIP(ipAddress);

    const now = new Date();

    // Update enrollment_tokens with device/IP info
    const { error } = await supabaseAdmin
      .from('enrollment_tokens')
      .update({
        enrollment_ip: ipAddress,
        enrollment_browser: browser + (browserVersion ? ` ${browserVersion}` : ''),
        enrollment_device: deviceType,
        enrollment_os: os + (osVersion ? ` ${osVersion}` : ''),
        enrollment_user_agent: ua,
        enrollment_city: geo.city,
        enrollment_country: geo.country,
        enrollment_region: geo.region,
        enrollment_latitude: geo.latitude,
        enrollment_longitude: geo.longitude,
        enrollment_place_name: geo.place_name,
        enrollment_logged_at: now.toISOString(),
      })
      .eq('token', enrollmentToken);

    if (error) {
      console.error('[log-enrollment] Error updating enrollment_tokens:', error);
      // Non-blocking — return success anyway so enrollment flow isn't interrupted
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[log-enrollment] Unexpected error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
