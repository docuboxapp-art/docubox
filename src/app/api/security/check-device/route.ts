import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendNewDeviceLoginEmail } from '@/lib/emailNotifications';
import { createAnonClient } from '@/lib/supabase/server';
import { createNotificationServer } from '@/lib/notificationsInApp.server';
import { approximateLoginLocation, clientIp, shouldAlertForLocation } from '@/lib/security/login-location';

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
    const ipAddress = clientIp(request.headers);

    const parsed = parseUserAgent(ua);
    const fingerprint = buildDeviceFingerprint(parsed);

    const { data: history, error: fetchError } = await supabaseAdmin
      .from('device_login_history')
      .select('id, device_fingerprint, login_count, first_seen_at, city, country')
      .eq('user_id', userId)
      .order('last_seen_at', { ascending: false })
      .limit(100);
    if (fetchError) throw fetchError;

    const previous = history || [];
    const existingDevice = previous.find((item) => item.device_fingerprint === fingerprint);
    const geo = approximateLoginLocation(request.headers, ipAddress);
    const isFirstDevice = previous.length === 0;
    const shouldAlert = shouldAlertForLocation(previous, fingerprint, geo);

    if (!existingDevice) {
      const { error: insertError } = await supabaseAdmin.from('device_login_history').insert({
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
      if (insertError) throw insertError;
    } else {
      const { error: updateError } = await supabaseAdmin
        .from('device_login_history')
        .update({
          last_seen_at: new Date().toISOString(),
          login_count: (existingDevice.login_count || 1) + 1,
          ip_address: ipAddress,
          city: geo.city ?? existingDevice.city,
          country: geo.country ?? existingDevice.country,
        })
        .eq('id', existingDevice.id);
      if (updateError) throw updateError;
    }

    if (shouldAlert) {
      const deviceTypeLabel = parsed.deviceType === 'mobile' ? 'Móvil' :
        parsed.deviceType === 'tablet' ? 'Tablet' : 'Escritorio';
      if (profile?.email || authData.user.email) {
        try {
          await sendNewDeviceLoginEmail({
            userEmail: profile?.email || authData.user.email || '',
            userName: profile?.full_name || undefined,
            deviceName: `${parsed.browser} (${deviceTypeLabel})`,
            ipAddress: ipAddress || undefined,
            city: geo.city || undefined,
            country: geo.country || undefined,
            loginTime: new Date().toISOString(),
          });
        } catch (emailErr) {
          console.error('[check-device] Email alert failed (non-blocking):', emailErr);
        }
      }
      createNotificationServer({
        userId: authData.user.id,
        type: 'alert',
        category: 'SECURITY',
        severity: 'critical',
        eventType: 'security.new_device',
        title: 'Acceso desde una ubicación inusual',
        description: `Detectamos un acceso desde ${parsed.browser} (${deviceTypeLabel}), ubicación aproximada por IP: ${[geo.city, geo.country].filter(Boolean).join(', ')}.`,
        priority: 'alta',
        actionUrl: '/configuracion',
        actionLabel: 'Revisar seguridad',
        deduplicationKey: `security.new_device:${authData.user.id}:${fingerprint}:${geo.country}:${geo.city}`,
        actorUserId: authData.user.id,
        metadata: {
          device_type: parsed.deviceType,
          browser: parsed.browser,
          city: geo.city,
          country: geo.country,
        },
      }).catch((notificationError) => {
        console.error('[check-device] In-app alert failed (non-blocking):', notificationError);
      });
    }

    return NextResponse.json({
      success: true,
      isNewDevice: !existingDevice && !isFirstDevice,
      isFirstDevice,
      alertSent: shouldAlert,
      device: {
        browser: parsed.browser,
        deviceType: parsed.deviceType,
        city: geo.city,
        country: geo.country,
      },
    });
  } catch (err) {
    console.error('[check-device] Error:', err);
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
