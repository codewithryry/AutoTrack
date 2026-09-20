-- One active loan per tool, enforced by the database.
--
-- `services/transactions.js` already refuses to issue a tool whose status is
-- not `Available`, and it checks for an existing open loan before writing. Both
-- checks are real and both stay. What neither can do is close the gap between
-- reading the status and writing the row: `db.runAtomic()` is a client-side
-- compensating-undo helper, not a database transaction, so two staff members
-- confirming the same tool in the same instant can both read `Available` and
-- both insert a loan. The result is one wrench recorded as held by two people,
-- and no amount of client-side checking can prevent it.
--
-- A partial unique index closes it at the only place that can arbitrate:
-- Postgres refuses the second insert outright. The application does not have to
-- be right about the ordering, because the database no longer allows the wrong
-- outcome to exist.
--
-- `Borrowed` and `Overdue` are the two statuses that mean "this tool is out" —
-- the same pair `ACTIVE_TXN_STATUSES` uses in `utils/constants.js`. `Returned`,
-- `Damaged` and `Lost` are all closed, so a tool may accumulate any number of
-- those without conflict, and its borrowing history is untouched.

-- A tool that is already double-booked would make the index fail to build, and
-- the migration would stop here rather than silently doing nothing. That is the
-- right outcome — the data has to be corrected first — but it should say so.
do $$
declare
  duplicates integer;
begin
  select count(*) into duplicates
  from (
    select tool_id
    from public.transactions
    where status in ('Borrowed', 'Overdue')
    group by tool_id
    having count(*) > 1
  ) as clashes;

  if duplicates > 0 then
    raise exception
      'Cannot enforce one active loan per tool: % tool(s) already have more than one open loan. '
      'Close the duplicates (return, or mark lost) and run this migration again.',
      duplicates;
  end if;
end $$;

create unique index if not exists transactions_one_active_per_tool
  on public.transactions (tool_id)
  where status in ('Borrowed', 'Overdue');

comment on index public.transactions_one_active_per_tool is
  'A tool can have at most one open loan. Enforced here because the check and '
  'the insert in services/transactions.js cannot be atomic from the client.';
