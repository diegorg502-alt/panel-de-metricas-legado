# CRM Bruno Gómez — Instrucciones de despliegue

## Credenciales de acceso
- URL: bruno.agencialegado.com
- Email: actitudconstante@gmail.com
- Contraseña: BrunoGomez

## Paso 1 — Subir a Vercel

1. Ve a vercel.com → New Project → sube esta carpeta
2. Deploy

## Paso 2 — Configurar dominio en Vercel

1. En Vercel → Settings → Domains → Add domain
2. Escribe: bruno.agencialegado.com
3. Vercel te dará un registro DNS (CNAME)

## Paso 3 — Configurar DNS en tu dominio

En el panel de tu dominio (donde compraste agencialegado.com):
1. Añade un registro CNAME:
   - Nombre: bruno
   - Valor: cname.vercel-dns.com (o el que te dé Vercel)
2. Espera 5-10 min a que propague

## Para añadir otro cliente (ej: Lucas)
1. En Supabase → Authentication → Add user (email + contraseña de Lucas)
2. En Supabase → SQL Editor:
   INSERT INTO crm_data (id, data) VALUES ('lucas_2026', '{}');
3. Duplica esta carpeta, cambia RECORD_ID a 'lucas_2026' en index.html
4. Sube a Vercel con dominio lucas.agencialegado.com

## Supabase SQL necesario (si no lo has ejecutado)
```sql
create table if not exists crm_data (
  id text primary key,
  data jsonb,
  updated_at timestamptz default now()
);
alter table crm_data enable row level security;
create policy "auth users" on crm_data for all to authenticated using (true) with check (true);
insert into crm_data (id, data) values ('bruno_2026', '{}') on conflict do nothing;
```
