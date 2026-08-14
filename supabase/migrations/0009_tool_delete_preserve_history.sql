-- Tool deletion that preserves history.
--
-- Deleting a tool used to be blocked by its own database: `transactions` and
-- `maintenance` both carry a `NOT NULL` foreign key `ON DELETE RESTRICT` to
-- `tools.id`, so a tool with a single historical loan could not be removed
-- from the inventory — the delete failed with the foreign-key error
-- "Another record still refers to this one, so it cannot be removed."
--
-- The fix follows the schema's own design. Both tables already denormalise
-- `tool_name`, and history is the point of a laboratory record, so detaching a
-- row from the live inventory must never destroy it. Two changes:
--
--  1. The foreign keys now detach on delete (`ON DELETE SET NULL`) instead of
--     refusing, and the columns become nullable so the reference can be
--     released. A deleted tool's transactions and maintenance history survive,
--     still carrying the tool's name; only the pointer to the now-removed
--     inventory row is cleared. No row is deleted, so no history is lost. This
--     is the same `on delete set null` choice the schema already makes for
--     `profiles.created_by` / `approved_by`.
--
--  2. A guard trigger refuses the delete while the tool is actively out on
--     loan (`Borrowed`/`Overdue`), so an open transaction can never be
--     silently detached — that would corrupt the live loan history. The
--     application checks this before calling delete; this trigger is the
--     boundary that cannot be edited away, mirroring the project's other
--     SECURITY DEFINER guard triggers.
--
-- `notifications` and `activity_logs` are not foreign keys to `tools` at all,
-- so this migration leaves them untouched: the append-only activity log keeps
-- every record of the tool, and ephemeral notification noise for a removed
-- tool is cleaned up by the application as before.

alter table public.transactions
  drop constraint if exists transactions_tool_id_fkey,
  add constraint transactions_tool_id_fkey
    foreign key (tool_id) references public.tools(id) on delete set null;
alter table public.transactions
  alter column tool_id drop not null;

alter table public.maintenance
  drop constraint if exists maintenance_tool_id_fkey,
  add constraint maintenance_tool_id_fkey
    foreign key (tool_id) references public.tools(id) on delete set null;
alter table public.maintenance
  alter column tool_id drop not null;

create or replace function public.tools_guard_active_loan_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.transactions t
     where t.tool_id = old.id
       and t.status in ('Borrowed', 'Overdue')
  ) then
    raise exception
      'This tool is still on loan. Process the return before deleting the record.';
  end if;
  return old;
end;
$$;

drop trigger if exists tools_guard_active_loan_delete on public.tools;
create trigger tools_guard_active_loan_delete
  before delete on public.tools
  for each row execute function public.tools_guard_active_loan_delete();