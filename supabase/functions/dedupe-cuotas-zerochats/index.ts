import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Deduplica cuotas en Zerochats fusionando cliente legacy (sin source) con cliente GHL.
// Uso: invocar manualmente cuando se necesite limpiar duplicados.
//
// Reglas conservadoras de match (1 legacy con 1 ghl):
//  A) Mismo email (case-insensitive) — match seguro.
//  B) El nombre legacy es subset estricto en palabras del nombre ghl,
//     siempre que cada palabra del legacy aparezca en el ghl en el mismo orden.
//     Ej: "ALEX" ⊂ "ALEX ESTEVE" ✓, "ALVARO PINEDA" ⊂ "ALVARO PINEDA GALÁN" ✓,
//          "ALEJANDRO MARTIN" ⊄ "ALEJANDRO BONET HOPPE" ✗.
//
// Si un legacy matchea con varios ghl, NO se fusiona (ambiguo) — se reporta.
// Si un ghl matchea con varios legacy, NO se fusiona — se reporta.
//
// Al fusionar:
//  - El cliente "ganador" es el GHL (mantiene ghl_contact_id, source='ghl').
//  - Pagos se fusionan: por mes se queda el mayor de ambos (suele ser el mismo).
//  - Si el legacy tenía ticket distinto y el ghl tiene 0 (caso ANUAL): se conserva el ticket del legacy.
//  - Si el legacy estaba marcado perdido y el ghl no: se conserva perdido + fechaPerdido del legacy.
//  - El cliente legacy se elimina.
//
// Devuelve un reporte con: fusionados, ambiguos, sin match.

const ZEROCHATS_RECORD_ID = 'zerochats_2026';

function normName(s: string): string {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(s: string): string[] {
  return normName(s).split(' ').filter(Boolean);
}

function isSubsetTokens(legacy: string[], ghl: string[]): boolean {
  if (legacy.length === 0 || legacy.length >= ghl.length) return false;
  // Todas las palabras del legacy deben estar en ghl en el mismo orden relativo
  let i = 0;
  for (const w of ghl) {
    if (legacy[i] === w) i++;
    if (i === legacy.length) return true;
  }
  return false;
}

function pickHighestPlan(a: string | null, b: string | null): string | null {
  const prio: Record<string, number> = { ANUAL: 3, BUSINESS: 2, PRO: 1 };
  const pa = a ? (prio[a] || 0) : 0;
  const pb = b ? (prio[b] || 0) : 0;
  return pb > pa ? b : a;
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dry') === '1';

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: cd, error: cdErr } = await sb.from('crm_data').select('data').eq('id', ZEROCHATS_RECORD_ID).single();
    if (cdErr) throw new Error(`No se encontró crm_data para ${ZEROCHATS_RECORD_ID}: ${cdErr.message}`);

    const S = cd?.data || {};
    if (!Array.isArray(S.cuotas) || !S.cuotas.length) {
      return new Response(JSON.stringify({ success: true, message: 'sin cuotas' }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    const legacy = S.cuotas.filter((c: any) => c.source !== 'ghl');
    const ghl = S.cuotas.filter((c: any) => c.source === 'ghl');

    type MatchPair = { legacy: any; ghl: any; reason: string };
    const merges: MatchPair[] = [];
    const ambiguous: any[] = [];
    const noMatch: any[] = [];

    for (const lg of legacy) {
      const lgEmail = String(lg.email || '').toLowerCase().trim();
      const lgTokens = tokens(lg.nombre);

      const candidates: { ghl: any; reason: string }[] = [];

      for (const gh of ghl) {
        const ghEmail = String(gh.email || '').toLowerCase().trim();
        const ghTokens = tokens(gh.nombre);

        if (lgEmail && ghEmail && lgEmail === ghEmail) {
          candidates.push({ ghl: gh, reason: 'email' });
          continue;
        }
        if (lgTokens.length > 0 && isSubsetTokens(lgTokens, ghTokens)) {
          candidates.push({ ghl: gh, reason: 'name_subset' });
        }
      }

      // Solo fusionar si hay match único
      if (candidates.length === 1) {
        merges.push({ legacy: lg, ghl: candidates[0].ghl, reason: candidates[0].reason });
      } else if (candidates.length > 1) {
        ambiguous.push({
          legacy_nombre: lg.nombre,
          legacy_plan: lg.plan,
          candidatos: candidates.map(c => ({ nombre: c.ghl.nombre, plan: c.ghl.plan, reason: c.reason })),
        });
      } else {
        noMatch.push({ nombre: lg.nombre, plan: lg.plan, ticket: lg.ticket });
      }
    }

    // Asegura que ningún ghl reciba más de un legacy (si pasa, descartar todos los merges sobre ese ghl)
    const ghlMatchCount = new Map<string, number>();
    for (const m of merges) {
      const k = m.ghl.ghl_contact_id || m.ghl.nombre;
      ghlMatchCount.set(k, (ghlMatchCount.get(k) || 0) + 1);
    }
    const ambiguousGhl: any[] = [];
    const finalMerges = merges.filter(m => {
      const k = m.ghl.ghl_contact_id || m.ghl.nombre;
      if ((ghlMatchCount.get(k) || 0) > 1) {
        ambiguousGhl.push({ legacy: m.legacy.nombre, ghl: m.ghl.nombre, reason: m.reason });
        return false;
      }
      return true;
    });

    let fusionados = 0;
    if (!dryRun) {
      const idsToRemove = new Set<any>();

      for (const { legacy: lg, ghl: gh } of finalMerges) {
        // Merge pagos
        const lgPagos = (lg.pagos && typeof lg.pagos === 'object' && !Array.isArray(lg.pagos)) ? lg.pagos : {};
        const ghPagos = (gh.pagos && typeof gh.pagos === 'object' && !Array.isArray(gh.pagos)) ? gh.pagos : {};
        const merged: Record<string, number> = { ...ghPagos };
        for (const k of Object.keys(lgPagos)) {
          const a = Number(lgPagos[k]) || 0;
          const b = Number(merged[k]) || 0;
          if (a > b) merged[k] = a;
          else if (!merged[k] && a) merged[k] = a;
        }
        gh.pagos = merged;

        // Plan: ganador es el más alto
        const bestPlan = pickHighestPlan(lg.plan || null, gh.plan || null);
        if (bestPlan) gh.plan = bestPlan;

        // Ticket: si ANUAL y ghl tenía 0, copiar del legacy si tiene
        if (gh.plan === 'ANUAL' && (!Number(gh.ticket) || gh.ticket === 0) && Number(lg.ticket) > 0) {
          gh.ticket = Number(lg.ticket);
        }

        // Email/teléfono: completar si falta
        if (!gh.email && lg.email) gh.email = lg.email;
        if (!gh.telefono && lg.telefono) gh.telefono = lg.telefono;

        // Perdido: si el legacy estaba perdido y el ghl no, conservar
        if (lg.perdido && !gh.perdido) {
          gh.perdido = true;
          gh.estado = 'Perdido';
          if (lg.fechaPerdido) gh.fechaPerdido = lg.fechaPerdido;
        }

        // Fecha de inicio: la más antigua
        if (lg.fechaInicio && (!gh.fechaInicio || lg.fechaInicio < gh.fechaInicio)) {
          gh.fechaInicio = lg.fechaInicio;
          gh.fecha_estimada = !!lg.fecha_estimada;
        }

        // Mantener nombre completo del ghl (más descriptivo). No tocar.

        idsToRemove.add(lg);
        fusionados++;
      }

      // Filtrar S.cuotas eliminando los legacy fusionados
      S.cuotas = S.cuotas.filter((c: any) => !idsToRemove.has(c));

      await sb.from('crm_data').upsert({ id: ZEROCHATS_RECORD_ID, data: S });
    }

    return new Response(JSON.stringify({
      success: true,
      dry_run: dryRun,
      total_cuotas_antes: legacy.length + ghl.length,
      total_cuotas_despues: dryRun ? null : S.cuotas.length,
      fusionados,
      legacy_count: legacy.length,
      ghl_count: ghl.length,
      sample_merges: finalMerges.slice(0, 30).map(m => ({
        legacy: m.legacy.nombre,
        ghl: m.ghl.nombre,
        reason: m.reason,
      })),
      ambiguous_legacy_to_multiple_ghl: ambiguous,
      ambiguous_ghl_received_multiple_legacy: ambiguousGhl,
      no_match_count: noMatch.length,
      no_match_sample: noMatch.slice(0, 50),
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
