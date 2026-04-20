import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CANAL_PATTERNS: [string, string[]][] = [
  ['QUIZ',        ['quiz','formulario','form','clientes potenciales','cp ','cp8','lead']],
  ['VSL ADS',     ['vsl ads']],
  ['VSL',         ['vsl','video sales']],
  ['WORKSHOP',    ['workshop','taller','masterclass','webinar']],
  ['LANZAMIENTO', ['lanzamiento','launch']],
  ['GOOGLE',      ['google','search','sem']],
  ['SOCIAL',      ['seguidores','social','instagram','ig','reels','facebook','fb']],
  ['YOUTUBE',     ['youtube','yt']],
];

function detectCanal(campaignName: string, clientCanales: string[]): string {
  const n = campaignName.toLowerCase();
  if (n.includes('seguidores')) return findClientCanal(clientCanales, 'SOCIAL');
  if (n.includes('clientes potenciales') || n.includes('formulario') || n.includes('form'))
    return findClientCanal(clientCanales, 'QUIZ');
  if (n.includes('vsl')) return findClientCanal(clientCanales, 'VSL', 'VSL ADS');
  for (const [canal, keys] of CANAL_PATTERNS) {
    if (keys.some(k => n.includes(k))) return findClientCanal(clientCanales, canal);
  }
  const adCanales = clientCanales.filter(c => !['REFERIDOS','ORGÁNICO','ORGANICO'].includes(c.toUpperCase()));
  return adCanales[0] || 'SOCIAL';
}

function findClientCanal(clientCanales: string[], ...candidates: string[]): string {
  for (const c of candidates) {
    const found = clientCanales.find(cc => cc.toUpperCase() === c.toUpperCase());
    if (found) return found;
  }
  for (const c of candidates) {
    const found = clientCanales.find(cc => cc.toUpperCase().includes(c.toUpperCase()));
    if (found) return found;
  }
  // No match: return first ad-related canal from client
  const adCanales = clientCanales.filter(c => !['REFERIDOS','ORGÁNICO','ORGANICO'].includes(c.toUpperCase()));
  return adCanales[0] || candidates[0];
}

function isSeguidoresCampaign(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('seguidores') || n.includes('followers') || n.includes('social funnel');
}

function getLeads(actions: any[]): number {
  if (!actions?.length) return 0;
  // Two types of "Clientes potenciales":
  // - onsite_conversion.lead_grouped = formularios instantáneos (Quique, Pablo, Paul)
  // - onsite_web_lead = clientes potenciales en sitio web (Zerochats)
  // Take the higher of both (each campaign uses one or the other)
  const grouped = actions.find((a: any) => a.action_type === 'onsite_conversion.lead_grouped');
  const webLead = actions.find((a: any) => a.action_type === 'onsite_web_lead');
  const groupedVal = grouped ? parseInt(grouped.value || '0') : 0;
  const webLeadVal = webLead ? parseInt(webLead.value || '0') : 0;
  if (groupedVal > 0 || webLeadVal > 0) return Math.max(groupedVal, webLeadVal);
  // Fallback: lead genérico
  const lead = actions.find((a: any) => a.action_type === 'lead');
  if (lead) return parseInt(lead.value || '0');
  return 0;
}

function getYesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getMonthStart(dateStr: string): string {
  return dateStr.substring(0, 8) + '01';
}

Deno.serve(async () => {
  try {
    const META_TOKEN = Deno.env.get('META_ACCESS_TOKEN')!;
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const yesterday = getYesterday();
    const mk = getMonthKey(yesterday);
    const monthStart = getMonthStart(yesterday);

    const { data: clients } = await sb
      .from('crm_clients')
      .select('*')
      .not('meta_ad_account_id', 'is', null);

    if (!clients?.length)
      return new Response(JSON.stringify({ success: true, message: 'No clients with Meta accounts' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });

    const results = [];

    for (const client of clients) {
      try {
        const campUrl = `https://graph.facebook.com/v22.0/act_${client.meta_ad_account_id}/insights?` +
          `fields=campaign_name,spend,actions` +
          `&level=campaign` +
          `&time_range={"since":"${yesterday}","until":"${yesterday}"}` +
          `&access_token=${META_TOKEN}`;

        const campRes = await fetch(campUrl);
        const campData = await campRes.json();

        if (campData.error) {
          results.push({ client: client.record_id, error: campData.error.message });
          continue;
        }

        const { data: cd } = await sb.from('crm_data').select('data').eq('id', client.record_id).single();
        const S = cd?.data || {};
        if (!S.kpis_diarios) S.kpis_diarios = {};
        if (!S.kpis_diarios[mk]) S.kpis_diarios[mk] = [];
        if (!S.ads) S.ads = {};

        const canalDaily: Record<string, { inversion: number; leads: number; isSocial: boolean }> = {};

        for (const c of (campData.data || [])) {
          const canal = detectCanal(c.campaign_name, client.canales || []);
          const social = isSeguidoresCampaign(c.campaign_name);
          if (!canalDaily[canal]) canalDaily[canal] = { inversion: 0, leads: 0, isSocial: social };

          canalDaily[canal].inversion += parseFloat(c.spend || '0');
          // Solo extraer leads para campañas que NO son de seguidores (QUIZ, VSL, LANZAMIENTO, etc.)
          if (!social) {
            canalDaily[canal].leads += getLeads(c.actions || []);
          }
        }

        for (const [canal, data] of Object.entries(canalDaily)) {
          if (data.inversion === 0 && data.leads === 0) continue;

          if (data.isSocial) {
            // Social: solo inversión. Seguidores se rellena manual. CPL se calcula en el CRM.
            // Preservar seguidores manuales si ya existen
            const existing = S.kpis_diarios[mk].find(
              (k: any) => k.dia === yesterday && k.canal === canal && k.source === 'meta'
            );
            const entry: any = {
              dia: yesterday,
              canal,
              inversion: Math.round(data.inversion * 100) / 100,
              leads: 0,
              seguidores: existing?.seguidores || 0, // preservar dato manual
              source: 'meta'
            };
            const idx = S.kpis_diarios[mk].findIndex(
              (k: any) => k.dia === yesterday && k.canal === canal && k.source === 'meta'
            );
            if (idx >= 0) S.kpis_diarios[mk][idx] = entry;
            else S.kpis_diarios[mk].push(entry);
          } else {
            // QUIZ/VSL/LANZAMIENTO: inversión + leads automáticos
            const entry: any = {
              dia: yesterday,
              canal,
              inversion: Math.round(data.inversion * 100) / 100,
              leads: data.leads,
              source: 'meta'
            };
            const idx = S.kpis_diarios[mk].findIndex(
              (k: any) => k.dia === yesterday && k.canal === canal && k.source === 'meta'
            );
            if (idx >= 0) S.kpis_diarios[mk][idx] = entry;
            else S.kpis_diarios[mk].push(entry);
          }
        }

        // TOP 3 ADS por canal — month-to-date (solo para campañas de leads)
        const adUrl = `https://graph.facebook.com/v22.0/act_${client.meta_ad_account_id}/insights?` +
          `fields=ad_name,ad_id,campaign_name,spend,actions` +
          `&level=ad` +
          `&time_range={"since":"${monthStart}","until":"${yesterday}"}` +
          `&sort=spend_descending` +
          `&limit=100` +
          `&access_token=${META_TOKEN}`;

        const adRes = await fetch(adUrl);
        const adData = await adRes.json();

        if (!adData.error && adData.data?.length) {
          const adsByCanal: Record<string, any[]> = {};

          for (const ad of adData.data) {
            const canal = detectCanal(ad.campaign_name, client.canales || []);
            if (!adsByCanal[canal]) adsByCanal[canal] = [];

            const spend = parseFloat(ad.spend || '0');
            const leads = getLeads(ad.actions || []);
            const cpl = leads > 0 ? Math.round(spend / leads * 100) / 100 : null;

            adsByCanal[canal].push({
              nombre: ad.ad_name,
              url: `https://www.facebook.com/ads/library/?id=${ad.ad_id}`,
              canal,
              inversion: Math.round(spend * 100) / 100,
              leads,
              cpl,
              ad_id: ad.ad_id,
              source: 'meta'
            });
          }

          const topAds: any[] = [];
          for (const [canal, ads] of Object.entries(adsByCanal)) {
            const sorted = ads
              .filter(a => a.leads > 0)
              .sort((a, b) => (b.leads || 0) - (a.leads || 0) || (a.cpl || 999) - (b.cpl || 999))
              .slice(0, 3);
            topAds.push(...sorted);
          }

          const manualAds = (S.ads[mk] || []).filter((a: any) => a.source !== 'meta');
          S.ads[mk] = [...topAds, ...manualAds];
        }

        await sb.from('crm_data').upsert({ id: client.record_id, data: S });

        results.push({
          client: client.record_id,
          kpis: Object.entries(canalDaily).map(([c, d]) => ({
            canal: c, inversion: d.inversion, leads: d.leads, tipo: d.isSocial ? 'social' : 'leads'
          })),
          top_ads: (S.ads[mk] || []).filter((a: any) => a.source === 'meta').length,
          date: yesterday
        });

      } catch (clientErr: any) {
        results.push({ client: client.record_id, error: clientErr.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
