drop policy if exists "Published worksheets are readable" on public.worksheets;

create policy "Owners can read worksheets"
on public.worksheets for select to authenticated
using (owner_id = (select auth.uid()));

create or replace function public.get_published_worksheet_by_code(lookup_public_code text)
returns table (
  id uuid,
  owner_id uuid,
  public_code text,
  title text,
  definition jsonb,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    worksheets.id,
    worksheets.owner_id,
    worksheets.public_code,
    worksheets.title,
    worksheets.definition,
    worksheets.status,
    worksheets.created_at,
    worksheets.updated_at
  from public.worksheets
  where worksheets.public_code = upper(trim(lookup_public_code))
    and worksheets.status = 'published'
  limit 1
$$;

create or replace function public.is_published_worksheet(lookup_worksheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.worksheets
    where worksheets.id = lookup_worksheet_id
      and worksheets.status = 'published'
  )
$$;

revoke all on function public.get_published_worksheet_by_code(text) from public;
revoke all on function public.is_published_worksheet(uuid) from public;
grant execute on function public.get_published_worksheet_by_code(text) to authenticated;
grant execute on function public.is_published_worksheet(uuid) to authenticated;

drop policy if exists "Participants can create their response" on public.responses;

create policy "Participants can create their response"
on public.responses for insert to authenticated
with check (
  participant_id = (select auth.uid())
  and public.is_published_worksheet(worksheet_id)
);
