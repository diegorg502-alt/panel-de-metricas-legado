import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Reconciliación de S.cuotas (Zerochats) con el CSV de clientes activos del 2026-05-01.
// Body: { dry_run?: boolean }
// Ejecuta:
//  1) Para cada cuota activa CRM con match en CSV (email, nombre exacto o subset): asigna plan/email del CSV, mantiene activa.
//  2) Para cada cuota activa CRM sin match: marca perdido con fechaPerdido=hoy.
//  3) Para cada CSV no matcheado con ninguna cuota: crea cuota nueva con pago del mes actual (PRO/BUSINESS).

const ZEROCHATS_RECORD_ID = 'zerochats_2026';
const MONTHS = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'];
const PLAN_AMOUNTS: Record<string, number> = { PRO: 247, BUSINESS: 397, ANUAL: 0 };

const CSV: { email: string; nombre: string; plan: string }[] = [
  {email:'guille@teamguille.com',nombre:'Guille',plan:'BUSINESS'},
  {email:'niall@vmasv.com',nombre:'Niall Wilde',plan:'BUSINESS_ANNUAL'},
  {email:'jeancarloentrenador@masterbpt.com',nombre:'Jean Carlo Diaz Carbonero',plan:'BUSINESS_ANNUAL'},
  {email:'tusaludenfamilia@outlook.com',nombre:'BELÉN',plan:'BUSINESS'},
  {email:'preparadorfisicovictordelolmo@gmail.com',nombre:'Víctor',plan:'BUSINESS'},
  {email:'nacho360fit@gmail.com',nombre:'Nacho Pérez Rodríguez',plan:'BUSINESS'},
  {email:'xavi@agency-master.com',nombre:'Xavier',plan:'BUSINESS_ANNUAL'},
  {email:'claudiamartinezjimenez1@gmail.com',nombre:'Claudia Martínez Jiménez',plan:'PRO'},
  {email:'adsensacademy@gmail.com',nombre:'Adsense Academy',plan:'BUSINESS_ANNUAL'},
  {email:'kevinmibz2@gmail.com',nombre:'Kevin Marí',plan:'BUSINESS'},
  {email:'isma.monteroo@gmail.com',nombre:'Ismael Montero Fernández',plan:'BUSINESS_ANNUAL'},
  {email:'alvarito.g.alfonsel@gmail.com',nombre:'Alvarito G Alfonsel',plan:'BUSINESS_ANNUAL'},
  {email:'info@javifisiofit.es',nombre:'Javier Torrejón',plan:'PRO'},
  {email:'juliaasierrabambu@gmail.com',nombre:'Julia Sierra',plan:'BUSINESS'},
  {email:'natalia.sancho00@gmail.com',nombre:'Natalia Sancho Arévalo',plan:'BUSINESS_ANNUAL'},
  {email:'adrigonzalezpt@gmail.com',nombre:'Adrián González García',plan:'PRO'},
  {email:'lidiaortizdezarater@gmail.com',nombre:'Lidia Ortiz de Zarate',plan:'BUSINESS'},
  {email:'oliver@escuelaie.net',nombre:'Oliver',plan:'BUSINESS'},
  {email:'hola@jesusgallegopt.com',nombre:'Jesús Gallego',plan:'BUSINESS_ANNUAL'},
  {email:'nako.workoutt@gmail.com',nombre:'Eneko',plan:'PRO'},
  {email:'niquet13@hotmail.com',nombre:'Miquel Nicolau Sastre',plan:'BUSINESS'},
  {email:'adamiancoach@gmail.com',nombre:'Alicia Setter',plan:'PRO'},
  {email:'carolinasatorres@gmail.com',nombre:'Carol Satorres Nutrición',plan:'BUSINESS_ANNUAL'},
  {email:'asesoramientofuoriclasse@gmail.com',nombre:'jesus martinez mateu',plan:'PRO'},
  {email:'andrea_porteiro@hotmail.com',nombre:'Andrea Porteiro Ocampo',plan:'BUSINESS'},
  {email:'sergiomorillascoach@gmail.com',nombre:'Sergio Morillas',plan:'PRO'},
  {email:'fernandoentrenador.ar@gmail.com',nombre:'Fernando Mèndez García',plan:'BUSINESS'},
  {email:'roblesrueda13@gmail.com',nombre:'Raul Robles Rueda',plan:'PRO'},
  {email:'miguelsauron88@gmail.com',nombre:'miguel martinez gil',plan:'BUSINESS_ANNUAL'},
  {email:'asesorias.teamguzman@gmail.com',nombre:'Asesorías Team Guzmán',plan:'PRO'},
  {email:'jmr@justmindandresults.com',nombre:'Juan Carlos Moyano Ruiz',plan:'BUSINESS_ANNUAL'},
  {email:'equiporeque@gmail.com',nombre:'EQUIPO REQUE',plan:'PRO'},
  {email:'fisiofles@gmail.com',nombre:'Fabian García Taibo',plan:'PRO'},
  {email:'am.lipedema@gmail.com',nombre:'Andreia Manteigas',plan:'BUSINESS'},
  {email:'ivanmartinezbazan20018@gmail.com',nombre:'Iván',plan:'BUSINESS'},
  {email:'mailbaseagency@gmail.com',nombre:'Zird IA',plan:'BUSINESS'},
  {email:'manuel.rives.pt@gmail.com',nombre:'Manuel Rives Cruz',plan:'BUSINESS'},
  {email:'calmatusibo@gmail.com',nombre:'Calma Tu SIBO',plan:'PRO'},
  {email:'mariosanchezfitness@gmail.com',nombre:'mario sanchez ortiz',plan:'PRO'},
  {email:'valenjavigoals@gmail.com',nombre:'Valen Javi',plan:'PRO'},
  {email:'alvarojaraboentrenadorpersonal@gmail.com',nombre:'Alvaro Jarabo Fernandez',plan:'BUSINESS'},
  {email:'daniel@finanzasdelemprendedor.com',nombre:'Daniel Gómez Fernández',plan:'BUSINESS'},
  {email:'soyvictoriglesias@gmail.com',nombre:'Victor Iglesias Gómez',plan:'BUSINESS_ANNUAL'},
  {email:'barbafittrainer@gmail.com',nombre:'Barbafit Trainer',plan:'BUSINESS_ANNUAL'},
  {email:'kevinsanchis.ad@gmail.com',nombre:'Kevin',plan:'BUSINESS'},
  {email:'actitudconstante@gmail.com',nombre:'Bruno Gomez Castilla',plan:'PRO'},
  {email:'pt.corchado@gmail.com',nombre:'Jose Luis Corchado Costoso',plan:'BUSINESS'},
  {email:'requeniia14@gmail.com',nombre:'Javier Requeni Guillem',plan:'PRO'},
  {email:'mgreadaptacionfisica@gmail.com',nombre:'Raúl Morales',plan:'PRO'},
  {email:'nutrimentoroficial@gmail.com',nombre:'NutriMentor',plan:'BUSINESS_ANNUAL'},
  {email:'nutrifacts.rm@gmail.com',nombre:'Nutri facts',plan:'BUSINESS'},
  {email:'jmesa98@gmail.com',nombre:'Jorge Mesa',plan:'PRO'},
  {email:'victorsemper2023@hotmail.com',nombre:'Víctor',plan:'PRO'},
  {email:'cristianalvarezgp@gmail.com',nombre:'CMTSYSTEMS',plan:'BUSINESS'},
  {email:'alvarodomtorres@gmail.com',nombre:'Alvaro Dominguez',plan:'PRO'},
  {email:'frangomez.fisio@stepbystepknee.org',nombre:'FRANCISCO JESÚS GÓMEZ CÓZAR',plan:'BUSINESS'},
  {email:'pvargasblanca@gmail.com',nombre:'Pablo Vargas',plan:'BUSINESS_ANNUAL'},
  {email:'victormartin.pt@gmail.com',nombre:'Victor Martin',plan:'PRO'},
  {email:'enol@clubstopdiabetes.com',nombre:'Enol',plan:'PRO'},
  {email:'mvcoachinfo@gmail.com',nombre:'MVCOACH',plan:'PRO'},
  {email:'luispozo90@gmail.com',nombre:'Luis Pozo',plan:'PRO'},
  {email:'adriortizarcos@gmail.com',nombre:'ADRIAN ORTIZ',plan:'PRO'},
  {email:'currete97@gmail.com',nombre:'Álvaro Moreno Rosado',plan:'PRO'},
  {email:'eddutrainer@gmail.com',nombre:'Eduardo Ramírez',plan:'BUSINESS'},
  {email:'diegocolungoteam@gmail.com',nombre:'Diego Colungo Torrecilla',plan:'PRO'},
  {email:'jaumett99@gmail.com',nombre:'Jaime Jorge Pastor',plan:'BUSINESS'},
  {email:'baumovment@gmail.com',nombre:'Baumovment SL',plan:'BUSINESS_ANNUAL'},
  {email:'dsmarcapersonal@gmail.com',nombre:'David Sánchez Crespo',plan:'PRO'},
  {email:'angelnevilley.2@gmail.com',nombre:'angel nevilley',plan:'BUSINESS'},
  {email:'albertotrainer17@gmail.com',nombre:'ALBERTO',plan:'BUSINESS'},
  {email:'keymove.center@gmail.com',nombre:'Pilar Conde Guerrero',plan:'PRO'},
  {email:'nutribuilder.coaching@gmail.com',nombre:'Julio Vizuete Velasco',plan:'BUSINESS_ANNUAL'},
  {email:'manumtrainer@gmail.com',nombre:'Manuel Martínez',plan:'BUSINESS_ANNUAL'},
  {email:'hectorkintusugi@gmail.com',nombre:'hector kintusugi',plan:'BUSINESS'},
  {email:'iciarmarsan8@gmail.com',nombre:'Ichiteamcoach',plan:'BUSINESS_ANNUAL'},
  {email:'entrenaconpat@gmail.com',nombre:'Patricia Benito',plan:'BUSINESS_ANNUAL'},
  {email:'dcmreadapta@gmail.com',nombre:'Daniel Canseco Macias',plan:'BUSINESS_ANNUAL'},
  {email:'javiorta.pt@gmail.com',nombre:'JAVIER ORTA',plan:'PRO'},
  {email:'juanalixpf@gmail.com',nombre:'Juan PT',plan:'PRO'},
  {email:'surflabacademy@gmail.com',nombre:'SurfLab Academy',plan:'BUSINESS'},
  {email:'franmaiglerfitness@gmail.com',nombre:'Fran Maigler',plan:'PRO'},
  {email:'jesusfisio.online@gmail.com',nombre:'Jesús Espinosa',plan:'BUSINESS_ANNUAL'},
  {email:'laranutricion@larasaludsindieta.com',nombre:'Lara Montero Jiménez',plan:'PRO'},
  {email:'htrainerpro@gmail.com',nombre:'Hector Ruiz',plan:'BUSINESS'},
  {email:'aarenasg2@gmail.com',nombre:'Ana Arenas González',plan:'BUSINESS'},
  {email:'hola@consultoia.com',nombre:'Alberto Egea Zorrilla',plan:'BUSINESS'},
  {email:'infofonsigonzalez@gmail.com',nombre:'Fonsi',plan:'BUSINESS_ANNUAL'},
  {email:'jorcap94@gmail.com',nombre:'Jordan',plan:'BUSINESS_ANNUAL'},
  {email:'carlos@fitmanpower.com',nombre:'Carlos',plan:'BUSINESS_ANNUAL'},
  {email:'info@kaizenproj.es',nombre:'David Ruiz',plan:'BUSINESS_ANNUAL'},
  {email:'gmiarnau97@gmail.com',nombre:'Guillem Sanchez',plan:'BUSINESS_ANNUAL'},
  {email:'setterjynfits@gmail.com',nombre:'setter jynfits',plan:'BUSINESS_ANNUAL'},
  {email:'jorgedierise1@gmail.com',nombre:'Águila Lluck Jorge Arturo',plan:'BUSINESS'},
  {email:'sellosjavi@gmail.com',nombre:'Javier Prado',plan:'PRO'},
  {email:'raguadotrainer@gmail.com',nombre:'Rafa Aguado',plan:'PRO'},
  {email:'info@lauraortizfit.com',nombre:'Laura Ortiz Fit',plan:'PRO'},
  {email:'escot.coach@gmail.com',nombre:'Victor Escot Garcia',plan:'BUSINESS'},
  {email:'entrenadorbertoni@gmail.com',nombre:'Pablo Andrés Bertoni Pérez',plan:'BUSINESS_ANNUAL'},
  {email:'caroigcbookings@gmail.com',nombre:'Caro igc',plan:'BUSINESS_ANNUAL'},
  {email:'oscarfitzn@gmail.com',nombre:'Oscar',plan:'BUSINESS_ANNUAL'},
  {email:'barvaruspubli@gmail.com',nombre:'alvaro barvarus',plan:'BUSINESS'},
  {email:'rafaalfarocoaching@gmail.com',nombre:'Rafa Alfaro Vega',plan:'BUSINESS'},
  {email:'xabiorbegar@gmail.com',nombre:'Xabi Orbe',plan:'BUSINESS'},
  {email:'jgs.entrenadorpersonal@gmail.com',nombre:'Javier Garcia Sanchez',plan:'BUSINESS'},
  {email:'rbnp.trainer@gmail.com',nombre:'Rubén Martínez Castro',plan:'BUSINESS'},
  {email:'eduardo.recio.rol@gmail.com',nombre:'Eduardo Recio Rol',plan:'BUSINESS'},
  {email:'asesoriasolaya@gmail.com',nombre:'Olaya Baker',plan:'PRO'},
  {email:'angelfh96@gmail.com',nombre:'Ángel Fernández',plan:'BUSINESS'},
  {email:'dianezfit@gmail.com',nombre:'David Dianez',plan:'PRO'},
  {email:'infonutricionatleta@gmail.com',nombre:'Pablo',plan:'PRO'},
  {email:'tools@unfiltrade.com',nombre:'Unfiltrade',plan:'BUSINESS'},
  {email:'noe@noelianutricionista.es',nombre:'Noelia García',plan:'BUSINESS_ANNUAL'},
  {email:'mabodyreshape@gmail.com',nombre:'Marco Asnaghi',plan:'BUSINESS_ANNUAL'},
  {email:'brianzaballos@gmail.com',nombre:'Brian Zaballos',plan:'PRO'},
  {email:'pablo@comunidaddepedro.com',nombre:'Pablo Moreno',plan:'BUSINESS_ANNUAL'},
  {email:'pacofrancosalud@gmail.com',nombre:'Paco',plan:'PRO'},
  {email:'agmindmove@gmail.com',nombre:'Alex Gonzalez',plan:'PRO'},
  {email:'info@thelandflippingempire.com',nombre:'Jeffrey Altidort',plan:'BUSINESS'},
  {email:'ikeralvfit@gmail.com',nombre:'Iker Álvarez Ballester',plan:'PRO'},
  {email:'keviiintp@gmail.com',nombre:'Kevin Tp',plan:'PRO'},
  {email:'lucasrodriguez.trainer@gmail.com',nombre:'Lucas Rodríguez Guillerón',plan:'PRO'},
  {email:'danifitasesorias2345@gmail.com',nombre:'Team Dani',plan:'BUSINESS_ANNUAL'},
  {email:'jesulisem7@gmail.com',nombre:'Jesus San Emeterio Molina',plan:'PRO'},
  {email:'asesorias.dfm@gmail.com',nombre:'Programa DFM',plan:'PRO'},
  {email:'kasteleducationfz@gmail.com',nombre:'Kastel Education',plan:'BUSINESS'},
  {email:'danielgallegosfisioterapia@gmail.com',nombre:'Daniel Gallegos Ruiz',plan:'PRO'},
  {email:'xavierghirardiniribas@gmail.com',nombre:'Xavier',plan:'BUSINESS'},
  {email:'rafaelestevezcotrina@gmail.com',nombre:'Rafael Estévez Cotrina',plan:'PRO'},
  {email:'santiivars@gmail.com',nombre:'Santi',plan:'PRO'},
  {email:'adaptacion.deportiva@gmail.com',nombre:'Alessandro Macchi Velasco',plan:'PRO'},
  {email:'deby.of.modelo@gmail.com',nombre:'Deby Modelo',plan:'PRO'},
  {email:'frangcdn@gmail.com',nombre:'Fran Gundín Cerviño',plan:'BUSINESS_ANNUAL'},
  {email:'readatpayrinde@gmail.com',nombre:'READAPTAYRINDE',plan:'BUSINESS'},
  {email:'nutri4train@gmail.com',nombre:'Nutri4train',plan:'BUSINESS'},
  {email:'hugopelaaezz@gmail.com',nombre:'Hugo Pelaez',plan:'BUSINESS_ANNUAL'},
  {email:'nutricionquerinde@gmail.com',nombre:'nutricionquerinde',plan:'BUSINESS_ANNUAL'},
  {email:'javi@alfa35.com',nombre:'Javi',plan:'PRO'},
  {email:'ivan.hombresenforma@gmail.com',nombre:'Hombres en Forma',plan:'PRO'},
  {email:'antoniovillarcoach@gmail.com',nombre:'Antonio Jesús Villar Ramiro',plan:'BUSINESS_ANNUAL'},
  {email:'yeraycombattrainer@gmail.com',nombre:'Yeray Combat Trainer',plan:'BUSINESS_ANNUAL'},
  {email:'delaorden.ivan@hotmail.com',nombre:'Ivan de la Orden',plan:'BUSINESS_ANNUAL'},
  {email:'barbertendence@gmail.com',nombre:'Juan Cruz',plan:'BUSINESS_ANNUAL'},
  {email:'psicoflores81@gmail.com',nombre:'Diego Flores',plan:'BUSINESS_ANNUAL'},
  {email:'albertogainerfit@gmail.com',nombre:'Alberto Tauste bachero',plan:'PRO'},
  {email:'marketeame.agency@gmail.com',nombre:'Marketea Me',plan:'PRO'},
  {email:'axelarellano20203@gmail.com',nombre:'AXEL NAHUEL',plan:'PRO'},
  {email:'david.cepeda.1401@gmail.com',nombre:'David',plan:'PRO'}
];

function normName(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().trim().replace(/\s+/g, ' ').replace(/[^A-ZÑ ]/g, '');
}
function tokens(s: string): string[] {
  return normName(s).split(' ').filter(Boolean);
}
function isSubsetTokens(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length > b.length) return false;
  let i = 0;
  for (const w of b) {
    if (a[i] === w) i++;
    if (i === a.length) return true;
  }
  return false;
}
function mapPlan(p: string): string {
  const u = (p || '').toUpperCase();
  if (u === 'BUSINESS_ANNUAL' || u === 'ANUAL') return 'ANUAL';
  if (u === 'BUSINESS') return 'BUSINESS';
  if (u === 'PRO') return 'PRO';
  return '';
}
function pagoKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${MONTHS[d.getMonth()]}`;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = !!body.dry_run;

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: cd, error: cdErr } = await sb.from('crm_data').select('data').eq('id', ZEROCHATS_RECORD_ID).single();
    if (cdErr) throw new Error(`No se encontró crm_data: ${cdErr.message}`);
    const S = cd?.data || {};
    if (!Array.isArray(S.cuotas)) S.cuotas = [];

    const csvNorm = CSV.map(r => ({
      email: r.email.toLowerCase().trim(),
      nombre: r.nombre,
      nombreNorm: normName(r.nombre),
      tokens: tokens(r.nombre),
      plan: mapPlan(r.plan),
    })).filter(r => r.plan);

    const today = new Date();
    const todayISO = today.toISOString().split('T')[0];
    const matchedCsvIdx = new Set<number>();

    let actualizados = 0;
    let marcadosPerdido = 0;
    const noMatchSamples: any[] = [];

    for (const cu of S.cuotas) {
      if (cu.perdido) continue;
      const cuEmail = String(cu.email || '').toLowerCase().trim();
      const cuTokens = tokens(cu.nombre || '');
      const cuNombreNorm = normName(cu.nombre || '');

      // Match único por CSV: cada CSV solo se asigna a una cuota
      let matchIdx = cuEmail ? csvNorm.findIndex((r, i) => !matchedCsvIdx.has(i) && r.email && r.email === cuEmail) : -1;
      if (matchIdx === -1 && cuNombreNorm) matchIdx = csvNorm.findIndex((r, i) => !matchedCsvIdx.has(i) && r.nombreNorm === cuNombreNorm);
      if (matchIdx === -1 && cuTokens.length > 0) {
        matchIdx = csvNorm.findIndex((r, i) => !matchedCsvIdx.has(i) && (isSubsetTokens(cuTokens, r.tokens) || isSubsetTokens(r.tokens, cuTokens)));
      }

      if (matchIdx >= 0) {
        const csvRow = csvNorm[matchIdx];
        matchedCsvIdx.add(matchIdx);
        const planAntes = cu.plan;
        if (csvRow.plan && cu.plan !== csvRow.plan) {
          cu.plan = csvRow.plan;
          if (csvRow.plan === 'PRO' || csvRow.plan === 'BUSINESS') cu.ticket = PLAN_AMOUNTS[csvRow.plan];
        }
        if (!cu.email && csvRow.email) cu.email = csvRow.email;
        if (planAntes !== cu.plan || (!cuEmail && csvRow.email)) actualizados++;
      } else {
        cu.perdido = true;
        cu.estado = 'Perdido';
        cu.fechaPerdido = todayISO;
        marcadosPerdido++;
        if (noMatchSamples.length < 50) noMatchSamples.push({ nombre: cu.nombre, email: cu.email, plan: cu.plan });
      }
    }

    let altasNuevas = 0;
    const altasSample: any[] = [];

    for (let i = 0; i < csvNorm.length; i++) {
      if (matchedCsvIdx.has(i)) continue;
      const r = csvNorm[i];
      const ticket = PLAN_AMOUNTS[r.plan] || 0;
      const newCuota: any = {
        nombre: r.nombre.toUpperCase(),
        email: r.email,
        telefono: '',
        plan: r.plan,
        fechaInicio: todayISO,
        fecha_estimada: true,
        ticket,
        nCuotas: 1,
        mesesServicio: 1,
        pagos: {},
        embudo: 'VSL ADS',
        source: 'csv',
      };
      if (ticket > 0) {
        newCuota.pagos[pagoKeyFromDate(today)] = ticket;
      }
      S.cuotas.push(newCuota);
      altasNuevas++;
      if (altasSample.length < 50) altasSample.push({ nombre: r.nombre, email: r.email, plan: r.plan });
    }

    if (!dryRun) {
      await sb.from('crm_data').upsert({ id: ZEROCHATS_RECORD_ID, data: S });
    }

    const totalActivosFinal = S.cuotas.filter((c: any) => !c.perdido).length;

    return new Response(JSON.stringify({
      success: true, dry_run: dryRun,
      csv_total: CSV.length, crm_total_cuotas: S.cuotas.length,
      activos_final: totalActivosFinal,
      actualizados, marcados_perdido: marcadosPerdido, altas_nuevas: altasNuevas,
      no_match_samples: noMatchSamples,
      altas_samples: altasSample,
      date: todayISO,
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
});
