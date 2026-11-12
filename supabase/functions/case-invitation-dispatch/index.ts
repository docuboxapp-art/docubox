import {serve} from 'https://deno.land/std@0.168.0/http/server.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {dispatchCaseMail} from '../../../src/lib/case-files/delivery.ts';
serve(async request=>{
  const stamp=request.headers.get('x-docubox-cron-timestamp')||'',signature=request.headers.get('x-docubox-cron-signature')||'';
  if(request.method!=='POST'||!/^\d{10}$/.test(stamp)||!/^[a-f0-9]{64}$/.test(signature)||Math.abs(Date.now()/1000-Number(stamp))>300)return new Response(null,{status:404});
  const service=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const secrets=await service.rpc('case_dispatch_secrets');
  if(secrets.error||!secrets.data?.auth||!secrets.data?.encryption)return new Response(null,{status:503});
  const expected=createHmac('sha256',secrets.data.auth).update(stamp).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return new Response(null,{status:404});
  const due=await service.rpc('case_dispatch_due',{p_limit:1});
  if(due.error)return Response.json({code:'CASE_DISPATCH_QUERY_FAILED'},{status:503});
  let processed=0,failed=0;
  for(const row of due.data||[]){
    try{
      await dispatchCaseMail(service,row.id,row.owner_user_id,{secret:secrets.data.encryption,apiKey:Deno.env.get('RESEND_API_KEY')||'',from:Deno.env.get('FROM_EMAIL')||'Docubox <noreply@docubox.com.mx>'});processed++;
    }catch{failed++;}
  }
  return Response.json({processed,failed});
});
