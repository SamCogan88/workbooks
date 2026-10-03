create extension if not exists pgcrypto;

create table public.worksheets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  public_code text not null unique,
  title text not null,
  definition jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  worksheet_id uuid not null references public.worksheets(id) on delete cascade,
  participant_id uuid not null references auth.users(id) on delete cascade,
  participant_label text,
  answers jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  unique (worksheet_id, participant_id)
);

create index worksheets_owner_idx on public.worksheets(owner_id);
create index worksheets_public_code_idx on public.worksheets(public_code);
create index responses_worksheet_idx on public.responses(worksheet_id);
create index responses_participant_idx on public.responses(participant_id);

alter table public.worksheets enable row level security;
alter table public.responses enable row level security;

revoke all on public.worksheets from anon, authenticated;
revoke all on public.responses from anon, authenticated;
grant select, insert, update, delete on public.worksheets to authenticated;
grant select, insert, update on public.responses to authenticated;

create policy "Published worksheets are readable"
on public.worksheets for select to authenticated
using (status = 'published' or owner_id = (select auth.uid()));

create policy "Permanent users can create worksheets"
on public.worksheets for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false
);

create policy "Owners can update worksheets"
on public.worksheets for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));

create policy "Owners can delete worksheets"
on public.worksheets for delete to authenticated
using (owner_id = (select auth.uid()));

create policy "Participants can create their response"
on public.responses for insert to authenticated
with check (
  participant_id = (select auth.uid())
  and exists (
    select 1 from public.worksheets
    where worksheets.id = responses.worksheet_id
      and worksheets.status = 'published'
  )
);

create policy "Participants and owners can read responses"
on public.responses for select to authenticated
using (
  participant_id = (select auth.uid())
  or exists (
    select 1 from public.worksheets
    where worksheets.id = responses.worksheet_id
      and worksheets.owner_id = (select auth.uid())
  )
);

create policy "Participants can update draft responses"
on public.responses for update to authenticated
using (participant_id = (select auth.uid()) and status = 'draft')
with check (participant_id = (select auth.uid()));
