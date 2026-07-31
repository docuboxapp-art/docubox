import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
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

  // Detect device type
  if (/bot|crawl|spider|slurp|mediapartners/i.test(ua)) {
    deviceType = 'bot';
  } else if (/tablet|ipad|playbook|silk/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(ua)) {
    deviceType = 'mobile';
  }

  // Detect OS
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
  }
  else if (/android ([\d.]+)/i.test(ua)) {
    os = 'Android';
    const m = ua.match(/android ([\d.]+)/i);
    osVersion = m ? m[1] : '';
  }
  else if (/iphone os ([\d_]+)/i.test(ua)) {
    os = 'iOS';
    const m = ua.match(/iphone os ([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, '.') : '';
  }
  else if (/ipad.*os ([\d_]+)/i.test(ua)) {
    os = 'iPadOS';
    const m = ua.match(/ipad.*os ([\d_]+)/i);
    osVersion = m ? m[1].replace(/_/g, '.') : '';
  }
  else if (/linux/i.test(ua)) { os = 'Linux'; }
  else if (/ubuntu/i.test(ua)) { os = 'Ubuntu'; }

  // Detect browser (order matters - check specific ones first)
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

interface GeoResult {
  country: string;
  countryCode: string;
  region: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  isp: string;
  // Mapbox reverse geocoding fields
  neighborhood: string;
  postcode: string;
  place_name: string;
}

async function getGeoFromIP(ip: string): Promise<GeoResult> {
  const defaultGeo: GeoResult = {
    country: 'Unknown',
    countryCode: '',
    region: '',
    city: 'Unknown',
    latitude: null,
    longitude: null,
    timezone: '',
    isp: '',
    neighborhood: '',
    postcode: '',
    place_name: '',
  };

  // Skip geolocation for local/private IPs
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.')) {
    return { ...defaultGeo, city: 'Local/Private Network' };
  }

  try {
    // Step 1: Get coordinates + basic geo from ip-api.com (free, no key required)
    const ipRes = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,lat,lon,timezone,isp`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!ipRes.ok) return defaultGeo;
    const ipData = await ipRes.json();
    if (ipData.status !== 'success') return defaultGeo;

    const baseGeo: GeoResult = {
      country: ipData.country || 'Unknown',
      countryCode: ipData.countryCode || '',
      region: ipData.regionName || '',
      city: ipData.city || 'Unknown',
      latitude: ipData.lat ?? null,
      longitude: ipData.lon ?? null,
      timezone: ipData.timezone || '',
      isp: ipData.isp || '',
      neighborhood: '',
      postcode: '',
      place_name: '',
    };

    // Step 2: Enrich with Mapbox reverse geocoding if we have coordinates and token
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
    const {
      userId,
      email,
      userAgent,
      loginSuccess = true,
      // New fields
      authMethod,           // 'password' | 'otp' | 'biometric' | 'totp'
      screenResolution,     // e.g. "1920x1080"
      language,             // e.g. "es-MX"
      platform,             // e.g. "MacIntel"
      deviceFingerprint,    // lightweight fingerprint from client
    } = body;

    // Extract real IP from headers
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfIp = request.headers.get('cf-connecting-ip');
    const ipAddress = cfIp || realIp || (forwarded ? forwarded.split(',')[0].trim() : null) || '127.0.0.1';

    // Parse user agent
    const ua = userAgent || request.headers.get('user-agent') || '';
    const { browser, browserVersion, os, osVersion, deviceType } = parseUserAgent(ua);

    // Get geolocation from IP (enriched with Mapbox reverse geocoding if available)
    const geo = await getGeoFromIP(ipAddress);

    const now = new Date();
    const accessDate = now.toISOString().split('T')[0];
    const accessTime = now.toTimeString().split(' ')[0];

    // Insert access log using service role (bypasses RLS)
    const { error } = await supabaseAdmin
      .from('access_logs')
      .insert({
        user_id: userId || null,
        email: email || null,
        ip_address: ipAddress,
        access_date: accessDate,
        access_time: accessTime,
        accessed_at: now.toISOString(),
        // Geolocation (IP-based)
        country: geo.country,
        country_code: geo.countryCode,
        region: geo.region,
        city: geo.city,
        latitude: geo.latitude,
        longitude: geo.longitude,
        timezone: geo.timezone,
        isp: geo.isp,
        // Reverse geocoding (Mapbox) — now persisted
        neighborhood: geo.neighborhood || null,
        postcode: geo.postcode || null,
        place_name: geo.place_name || null,
        // Device info
        browser: browser,
        browser_version: browserVersion,
        operating_system: os,
        os_version: osVersion,
        device_type: deviceType,
        user_agent: ua,
        // Extra device fields from client
        screen_resolution: screenResolution || null,
        language: language || null,
        platform: platform || null,
        device_fingerprint: deviceFingerprint || null,
        // Auth metadata
        auth_method: authMethod || null,
        login_success: loginSuccess,
      });

    if (error) {
      console.error('Error inserting access log:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      geo: {
        city: geo.city,
        region: geo.region,
        country: geo.country,
        neighborhood: geo.neighborhood,
        postcode: geo.postcode,
        place_name: geo.place_name,
        latitude: geo.latitude,
        longitude: geo.longitude,
      },
    });
  } catch (err) {
    console.error('Access log API error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
