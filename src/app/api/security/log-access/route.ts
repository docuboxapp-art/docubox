import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { approximateLoginLocation, clientIp } from '@/lib/security/login-location';
import { createAnonClient } from '@/lib/supabase/server';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      userId,
      email,
      loginSuccess = true,
      // New fields
      authMethod,           // 'password' | 'otp' | 'biometric' | 'totp'
      screenResolution,     // e.g. "1920x1080"
      language,             // e.g. "es-MX"
      platform,             // e.g. "MacIntel"
      deviceFingerprint,    // lightweight fingerprint from client
    } = body;

    let verifiedUserId: string | null = null;
    let verifiedEmail: string | null = null;
    if (loginSuccess) {
      const authorization = request.headers.get('authorization') || '';
      const token = authorization.replace(/^Bearer\s+/i, '');
      if (!token) {
        return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
      }
      const { data: authData, error: authError } = await createAnonClient().auth.getUser(token);
      if (authError || !authData.user || (userId && authData.user.id !== userId)) {
        return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
      }
      verifiedUserId = authData.user.id;
      verifiedEmail = authData.user.email || null;
    }

    const ipAddress = clientIp(request.headers);

    // Parse user agent
    const ua = request.headers.get('user-agent') || '';
    const { browser, browserVersion, os, osVersion, deviceType } = parseUserAgent(ua);

    const geo = approximateLoginLocation(request.headers, ipAddress);

    const now = new Date();
    const accessDate = now.toISOString().split('T')[0];
    const accessTime = now.toTimeString().split(' ')[0];

    // Insert access log using service role (bypasses RLS)
    const { error } = await supabaseAdmin
      .from('access_logs')
      .insert({
        user_id: verifiedUserId,
        email: verifiedEmail || (!loginSuccess ? email || null : null),
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
        isp: null,
        neighborhood: null,
        postcode: null,
        place_name: null,
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
        locationType: 'approximate_ip',
        latitude: geo.latitude,
        longitude: geo.longitude,
      },
    });
  } catch (err) {
    console.error('Access log API error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
