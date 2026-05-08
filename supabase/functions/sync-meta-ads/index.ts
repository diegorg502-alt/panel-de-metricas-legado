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

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Detecta si una campaña es Quiz Templado por su nombre.
// Convención global: nombre con "templado", "warm", "tofu", "abo" → templado.
// Si no, default = QUIZ frío.
function isQuizTempladoCampaign(name: string): boolean {
  const n = normalize(name);
  return n.includes('templado') || n.includes('warm') || n.includes('tofu');
}

function isQuizFrioCampaign(name: string): boolean {
  const n = normalize(name);
  return n.includes('frio') || n.includes('cold') || n.includes('bofu');
}

function detectCanal(campaignName: string, clientCanales: string[]): string {
  const n = campaignName.toLowerCase();
  if (n.includes('seguidores')) return findClientCanal(clientCanales, 'SOCIAL');
  // Quiz Templado: detecta primero por nombre. Si el cliente tiene el canal,
  // mapea ahí; si no, cae a QUIZ normal (backwards-compat).
  if (n.includes('clientes potenciales') || n.includes('formulario') || n.includes('form') || n.includes('quiz')) {
    if (isQuizTempladoCampaign(n)) {
      return findClientCanal(clientCanales, 'QUIZ TEMPLADO', 'QUIZ', 'ADS');
    }
    return findClientCanal(clientCanales, 'QUIZ', 'ADS');
  }
  if (n.includes('vsl')) return findClientCanal(clientCanales, 'VSL', 'VSL ADS', 'ADS');
  for (const [canal, keys] of CANAL_PATTERNS) {
    if (keys.some(k => n.includes(k))) return findClientCanal(clientCanales, canal, 'ADS');
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
  const adCanales = clientCanales.filter(c => !['REFERIDOS','ORGÁNICO','ORGANICO'].includes(c.toUpperCase()));
  return adCanales[0] || candidates[0];
}

function isSeguidoresCampaign(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('seguidores') || n.includes('followers') || n.includes('social funnel');
}

function getLeads(actions: any[]): number {
  if (!actions?.length) return 0;
  const grouped = actions.find((a: any) => a.action_type === 'onsite_conversion.lead_grouped');
  const webLead = actions.find((a: any) => a.action_type === 'onsite_web_lead');
  const groupedVal = grouped ? parseInt(grouped.value || '0') : 0;
  const webLeadVal = webLead ? parseInt(webLead.value || '0') : 0;
  if (groupedVal > 0 || webLeadVal > 0) return Math.max(groupedVal, webLeadVal);
  const lead = actions.find((a: any) => a.action_type === 'lead');
  if (lead) return parseInt(lead.value || '0');
  return 0;
}

function getYesterday(): string {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function getMonthKey(dateStr: string): string {
  return dateStr.substring(0, 7);
}

function getMonthStart(dateStr: string): string {
  return dateStr.substring(0, 8) + '01';
}

function matchesFilter(campaignName: string, filters: string[] | null | undefined): boolean {
  if (!filters || !filters.length) return true;
  const n = normalize(campaignName);
  return filters.some(f => n.includes(normalize(f)));
}

async function fetchCampaignInsights(adAccountId: string, date: string, token: string) {
  const url = `https://graph.facebook.com/v22.0/act_${adAccountId}/insights?` +
    `fields=campaign_name,spend,actions` +
    `&level=campaign` +
    `&time_range={"since":"${date}","until":"${date}"}` +
    `&access_token=${token}`;
  const r = await fetch(url);
  return await r.json();
}

async function fetchTopAds(adAccountId: string, monthStart: string, until: string, token: string) {
  const url = `https://graph.facebook.com/v22.0/act_${adAccountId}/insights?` +
    `fields=ad_name,ad_id,campaign_name,spend,actions` +
    `&level=ad` +
    `&time_range={"since":"${monthStart}","until":"${until}"}` +
    `&sort=spend_descending` +
    `&limit=100` +
    `&access_token=${token}`;
  const r = await fetch(url);
  return await r.json();
}

function applyDayInsights(S: any, date: string, campData: any, clientCanales: string[], filters: string[] | null) {
  const mk = getMonthKey(date);
  if (!S.kpis_diarios[mk]) S.kpis_diarios[mk] = [];

  const canalDaily: Record<string, { inversion: number; leads: number }> = {};
  const seenCampaigns: any[] = [];
  for (const c of (campData.data || [])) {
    const matched = matchesFilter(c.campaign_name, filters);
    const social = isSeguidoresCampaign(c.campaign_name);
    seenCampaigns.push({ name: c.campaign_name, spend: parseFloat(c.spend || '0'), matched, social, skipped: social });
    if (!matched) continue;
    // Social Funnel queda fuera del agregado: no aporta inversión, ni leads, ni canal.
    // Los seguidores se introducen manualmente en kpis_diarios desde la UI.
    if (social) continue;
    const canal = detectCanal(c.campaign_name, clientCanales);
    if (!canalDaily[canal]) canalDaily[canal] = { inversion: 0, leads: 0 };
    canalDaily[canal].inversion += parseFloat(c.spend || '0');
    canalDaily[canal].leads += getLeads(c.actions || []);
  }

  const summary: any[] = [];
  for (const [canal, d] of Object.entries(canalDaily)) {
    if (d.inversion === 0 && d.leads === 0) continue;
    const entry: any = { dia: date, canal, inversion: Math.round(d.inversion * 100) / 100, leads: d.leads, source: 'meta' };
    const idx = S.kpis_diarios[mk].findIndex(
      (k: any) => k.dia === date && k.canal === canal && k.source === 'meta'
    );
    if (idx >= 0) S.kpis_diarios[mk][idx] = entry;
    else S.kpis_diarios[mk].push(entry);
    summary.push({ canal, inversion: entry.inversion, leads: entry.leads, tipo: 'leads' });
  }
  return { summary, seenCampaigns };
}

function applyTopAds(S: any, date: string, adData: any, clientCanales: string[], filters: string[] | null) {
  if (adData.error || !adData.data?.length) return 0;
  const mk = getMonthKey(date);
  const adsByCanal: Record<string, any[]> = {};
  for (const ad of adData.data) {
    if (!matchesFilter(ad.campaign_name, filters)) continue;
    // Social Funnel también se excluye de Top Ads: no es objetivo de leads, no compite por CPL.
    if (isSeguidoresCampaign(ad.campaign_name)) continue;
    const canal = detectCanal(ad.campaign_name, clientCanales);
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
  for (const [, ads] of Object.entries(adsByCanal)) {
    const sorted = ads
      .filter(a => a.leads > 0)
      .sort((a, b) => (b.leads || 0) - (a.leads || 0) || (a.cpl || 999) - (b.cpl || 999))
      .slice(0, 3);
    topAds.push(...sorted);
  }
  if (!S.ads) S.ads = {};
  const manualAds = (S.ads[mk] || []).filter((a: any) => a.source !== 'meta');
  S.ads[mk] = [...topAds, ...manualAds];
  return topAds.length;
}

Deno.serve(async (req) => {
  try {
    const META_TOKEN = Deno.env.get('META_ACCESS_TOKEN')!;
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    let body: any = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    }

    const dates: string[] = (Array.isArray(body.dates) && body.dates.length)
      ? body.dates
      : [getYesterday()];
    const targetClientId: string | undefined = body.client_id;
    const dryRun: boolean = !!body.dry_run;
    const overrideFilter: string[] | null = Array.isArray(body.campaign_filter) ? body.campaign_filter : null;

    let q = sb.from('crm_clients').select('*').not('meta_ad_account_id', 'is', null);
    if (targetClientId) q = q.eq('record_id', targetClientId);
    const { data: clients } = await q;

    if (!clients?.length) {
      return new Response(JSON.stringify({ success: true, message: 'No clients with Meta accounts' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const results: any[] = [];

    for (const client of clients) {
      try {
        const filters: string[] | null = overrideFilter ?? (client.meta_campaign_filter ?? null);

        const { data: cd } = await sb.from('crm_data').select('data').eq('id', client.record_id).single();
        // Trabajar sobre una copia profunda en dry_run para no riesgo de mutación accidental
        const baseData = cd?.data || {};
        const S = dryRun ? JSON.parse(JSON.stringify(baseData)) : baseData;
        if (!S.kpis_diarios) S.kpis_diarios = {};
        if (!S.ads) S.ads = {};

        const perDay: any[] = [];
        let lastDateProcessed: string | null = null;

        for (const date of dates) {
          const campData = await fetchCampaignInsights(client.meta_ad_account_id, date, META_TOKEN);
          if (campData.error) {
            perDay.push({ date, error: campData.error.message });
            continue;
          }
          const { summary, seenCampaigns } = applyDayInsights(S, date, campData, client.canales || [], filters);
          perDay.push({ date, kpis: summary, campaigns: seenCampaigns });
          lastDateProcessed = date;
        }

        let topAdsCount = 0;
        if (lastDateProcessed && !dryRun) {
          const adData = await fetchTopAds(
            client.meta_ad_account_id,
            getMonthStart(lastDateProcessed),
            lastDateProcessed,
            META_TOKEN
          );
          topAdsCount = applyTopAds(S, lastDateProcessed, adData, client.canales || [], filters);
        }

        if (!dryRun) {
          await sb.from('crm_data').upsert({ id: client.record_id, data: S });
        }

        results.push({
          client: client.record_id,
          filter_used: filters,
          days: perDay,
          top_ads: topAdsCount,
          dry_run: dryRun
        });
      } catch (clientErr: any) {
        results.push({ client: client.record_id, error: clientErr.message });
      }
    }

    return new Response(JSON.stringify({ success: true, mode: dryRun ? 'dry_run' : (dates.length > 1 ? 'backfill' : 'cron'), dates, results }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
