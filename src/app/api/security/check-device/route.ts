import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendNewDeviceLoginEmail } from '@/lib/emailNotifications';
import { createAnonClient } from '@/lib/supabase/server';
import { createNotificationServer } from '@/lib/notificationsInApp.server';

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

  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini/i.test(ua)) {
    deviceType = 'mobile';
  }

  if (/windows nt 10/i.test(ua)) {
    os = 'Windows';
    osVersion = '10';
  } else if (/windows nt 11/i.test(ua)) {
    os = 'Windows';
    osVersion = '11';
  } else if (/windows nt 6\.3/i.test(ua)) {
    os = 'Windows';
    osVersion = '8.1';
  } else if (/windows nt 6\.1/i.test(ua)) {
    os = 'Windows';
    osVersion = '7';
  } else if (/windows/i.test(ua)) {
    os = 'Windows';
  } else if (/mac os x ([\d_]+)/i.test(ua)) {
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
  } else if (/linux/i.test(ua)) {
    os = 'Linux';
  }

  if (/edg\/([\d.]+)/i.test(ua)) {
    browser = 'Edge';
    const m = ua.match(/edg\/([\d.]+)/i);
    browserVersion = m ? m[1] : '';
  } else if (/opr\/([\d.]+)/i.test(ua)) {
    browser = 'Opera';
    const m = ua.match(/opr\/([\d.]+)/i);
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
  }

  return { browser, browserVersion, os, osVersion, deviceType };
}

function buildDeviceFingerprint(parsed: ReturnType<typeof parseUserAgent>): string {
  return `${parsed.browser}|${parsed.os}|${parsed.deviceType}`.toLowerCase().replace(/\s+/g, '_');
}

async function getGeoFromIP(ip: string): Promise<{ city: string; country: string }> {
  if (
    !ip ||
    ip === '::1' ||
    ip === '127.0.0.1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.')
  ) {
    return { city: 'Red local', country: 'Local' };
  }
  try {
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { city: 'Desconocida', country: 'Desconocido' };
    const data = await res.json();
    if (data.status !== 'success') return { city: 'Desconocida', country: 'Desconocido' };
    return { city: data.city || 'Desconocida', country: data.country || 'Desconocido' };
  } catch {
    return { city: 'Desconocida', country: 'Desconocido' };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId required' }, { status: 400 });
    }

    const authorization = request.headers.get('authorization') || '';
    const token = authorization.replace(/^Bearer\s+/i, '');
    if (!token) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 401 });
    }
    const { data: authData, error: authError } = await createAnonClient().auth.getUser(token);
    if (authError || !authData.user || authData.user.id !== userId) {
      return NextResponse.json({ success: false, error: 'No autorizado' }, { status: 403 });
    }

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('email,full_name')
      .eq('id', authData.user.id)
      .maybeSingle();

    const ua = request.headers.get('user-agent') || '';
    const forwarded = request.headers.get('x-forwarded-for');
    const realIp = request.headers.get('x-real-ip');
    const cfIp = request.headers.get('cf-connecting-ip');
    const ipAddress =
      cfIp || realIp || (forwarded ? forwarded.split(',')[0].trim() : null) || '127.0.0.1';

    const parsed = parseUserAgent(ua);
    const fingerprint = buildDeviceFingerprint(parsed);

    // Check if this device fingerprint is known for this user
    const { data: existingDevice, error: fetchError } = await supabaseAdmin
      .from('device_login_history')
      .select('id, is_trusted, login_count, first_seen_at')
      .eq('user_id', userId)
      .eq('device_fingerprint', fingerprint)
      .maybeSingle();

    const geo = await getGeoFromIP(ipAddress);

    if (!existingDevice) {
      // Register new device
      await supabaseAdmin.from('device_login_history').insert({
        user_id: userId,
        device_fingerprint: fingerprint,
        device_type: parsed.deviceType,
        browser: parsed.browser,
        browser_version: parsed.browserVersion,
        operating_system: parsed.os,
        os_version: parsed.osVersion,
        user_agent: ua,
        ip_address: ipAddress,
        city: geo.city,
        country: geo.country,
        is_trusted: false,
        login_count: 1,
      });

      // Count how many devices this user has (including the one just inserted)
      const { count } = await supabaseAdmin
        .from('device_login_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      const isFirstDevice = (count || 0) <= 1;

      // Send alert email only if this is NOT the first device (first login is normal)
      if (!isFirstDevice && (profile?.email || authData.user.email)) {
        const deviceTypeLabel =
          parsed.deviceType === 'mobile'
            ? 'Móvil'
            : parsed.deviceType === 'tablet'
              ? 'Tablet'
              : 'Escritorio';
        const deviceLabel = `${parsed.browser} en ${parsed.os} (${deviceTypeLabel})`;
        try {
          await sendNewDeviceLoginEmail({
            userEmail: profile?.email || authData.user.email || '',
            userName: profile?.full_name || undefined,
            deviceName: deviceLabel,
            ipAddress,
            city: geo.city,
            country: geo.country,
            loginTime: new Date().toISOString(),
          });
        } catch (emailErr) {
          console.error('[check-device] Email alert failed (non-blocking):', emailErr);
        }
      }

      if (!isFirstDevice) {
        const deviceTypeLabel =
          parsed.deviceType === 'mobile'
            ? 'móvil'
            : parsed.deviceType === 'tablet'
              ? 'tablet'
              : 'escritorio';
        createNotificationServer({
          userId: authData.user.id,
          type: 'alert',
          category: 'SECURITY',
          severity: 'critical',
          eventType: 'security.new_device',
          title: 'Nuevo acceso desde un dispositivo',
          description: `Detectamos un acceso desde ${parsed.browser} en ${parsed.os} (${deviceTypeLabel})${geo.city ? `, ${geo.city}` : ''}.`,
          priority: 'alta',
          actionUrl: '/configuracion',
          actionLabel: 'Revisar seguridad',
          deduplicationKey: `security.new_device:${authData.user.id}:${fingerprint}`,
          actorUserId: authData.user.id,
          metadata: {
            device_type: parsed.deviceType,
            browser: parsed.browser,
            os: parsed.os,
            city: geo.city,
            country: geo.country,
          },
        }).catch((notificationError) => {
          console.error('[check-device] In-app alert failed (non-blocking):', notificationError);
        });
      }

      return NextResponse.json({
        success: true,
        isNewDevice: !isFirstDevice,
        isFirstDevice,
        device: {
          browser: parsed.browser,
          os: parsed.os,
          deviceType: parsed.deviceType,
          city: geo.city,
          country: geo.country,
        },
      });
    } else {
      // Known device — update last_seen and increment count
      await supabaseAdmin
        .from('device_login_history')
        .update({
          last_seen_at: new Date().toISOString(),
          login_count: (existingDevice.login_count || 1) + 1,
          ip_address: ipAddress,
          city: geo.city,
          country: geo.country,
        })
        .eq('id', existingDevice.id);

      return NextResponse.json({
        success: true,
        isNewDevice: false,
        isFirstDevice: false,
        device: {
          browser: parsed.browser,
          os: parsed.os,
          deviceType: parsed.deviceType,
          city: geo.city,
          country: geo.country,
          loginCount: (existingDevice.login_count || 1) + 1,
          firstSeen: existingDevice.first_seen_at,
        },
      });
    }
  } catch (err) {
    console.error('[check-device] Error:', err);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
