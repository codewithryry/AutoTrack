/* ------------------------------------------------------------------ *
 * 0030 — is another account already asking for this tool?
 *
 * `tool_requests` reads are scoped to the caller every way a read can be: the
 * data layer filters to `user_id`, and the `0012` select policy hides everyone
 * else's rows (`is_staff() or ... user_id = auth.uid()::text`). So the question
 * "has another student already asked for this tool?" can never be answered by a
 * local `listForTool` against the current account — the rows the check needs are
 * the very rows the reader is not allowed to see.
 *
 * This function answers exactly that single question, yes/no, through
 * `security definer` so it reads the table outside RLS — the same escape hatch
 * `in_conversation` and `delete_own_account` already use. It takes the
 * requester's id so the caller's own row is never counted against them, and it
 * returns only a boolean, never a row, so nothing about another account's
 * request details leaks.
 *
 * Only a request that is still live blocks the tool: `Pending` is waiting on a
 * decision, and `Approved` is a hold that has not yet been collected — or was
 * collected and the loan is still open. A request that was decided against
 * (`Rejected`), dropped by either side (`Cancelled`, `Expired`), or fulfilled
 * and closed (`Approved` whose loan has since been handed back) is history and
 * never stands in the way of a new ask. The request rows are kept — only the
 * check ignores the finished ones. A tool that is actually out on loan blocks
 * on its own, whether or not a request row trails behind it.
 *
 * A closed loan is read straight off the `transactions` rows — the same "spent"
 * test the request service runs for the requester's own duplicates — and also
 * through the reservation link, because the two record the same handover by
 * different routes: a borrow taken on the approval alone never writes the link,
 * while a loan whose `borrow_date` was stamped by a client clock a little behind
 * `decided_at` is missed by the date test. Either witness is enough.
 *
 * "Closed" is `return_date is not null` or a status that is not one of the two
 * that still have the tool out of the room (`Borrowed`, `Overdue`) — so a loan
 * returned, damaged *or* lost is over, and a returned tool stops blocking the
 * moment the return is written. The same `return_date` reading guards the
 * currently-out branch below, so a row left on a stale `Overdue` after its
 * return is not read as a live loan.
 *
 * All of it is read server-side, on the live tables — never from the cached
 * copies the PWA serves reads from — so availability is answered by what the
 * database says now.
 * ------------------------------------------------------------------ */

drop function if exists public.tool_request_conflict(text, text);

create or replace function public.tool_request_conflict(p_tool_id text, p_requester_id text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tool_requests r
    where r.tool_id = p_tool_id
      and r.user_id <> p_requester_id
      and r.status in ('Pending', 'Approved')
      and not exists (
        -- An approved request stops blocking once the loan it authorised has
        -- been collected (after the decision, or through its own hold) and
        -- closed (returned, damaged, lost).
        select 1
        from public.transactions t
        where t.tool_id = r.tool_id
          and t.user_id = r.user_id
          and (
            (r.decided_at is not null and t.borrow_date >= r.decided_at)
            or exists (
              select 1
              from public.reservations v
              where v.request_id = r.id
                and v.transaction_id = t.id
            )
          )
          and (t.return_date is not null or t.status not in ('Borrowed', 'Overdue'))
      )
  )
  or exists (
    -- The tool is out of the room right now.
    select 1
    from public.transactions t
    where t.tool_id = p_tool_id
      and t.status in ('Borrowed', 'Overdue')
      and t.return_date is null
  )
$$;

grant execute on function public.tool_request_conflict(text, text) to authenticated;