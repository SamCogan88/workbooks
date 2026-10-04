create or replace function public.set_response_server_owned_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
    if new.status = 'submitted' then
      new.submitted_at := now();
    else
      new.submitted_at := null;
    end if;
    return new;
  end if;

  if new.worksheet_id is distinct from old.worksheet_id then
    raise exception 'responses.worksheet_id cannot be changed';
  end if;

  if new.participant_id is distinct from old.participant_id then
    raise exception 'responses.participant_id cannot be changed';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'responses.created_at cannot be changed';
  end if;

  new.updated_at := now();
  if old.status is distinct from 'submitted' and new.status = 'submitted' then
    new.submitted_at := now();
  elsif new.status = 'submitted' then
    new.submitted_at := old.submitted_at;
  else
    new.submitted_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists set_response_server_owned_fields on public.responses;
create trigger set_response_server_owned_fields
before insert or update on public.responses
for each row
execute function public.set_response_server_owned_fields();

drop policy if exists "Participants can update draft responses" on public.responses;
create policy "Participants can update draft responses"
on public.responses for update to authenticated
using (participant_id = (select auth.uid()) and status = 'draft')
with check (
  participant_id = (select auth.uid())
  and public.is_published_worksheet(worksheet_id)
);
