/* ------------------------------------------------------------------ *
 * 0020 — one ask, several tools: the batch
 *
 * Two columns, and nothing else:
 *
 *   tool_requests.batch_id   the ask several tools were raised under
 *   transactions.batch_id    carried onto the loan each of them becomes
 *
 * A request is still one row per tool — that is what a hold is created for,
 * what the borrow desk collects, and what a return closes — so nothing about
 * approval, reservations, borrowing or returning changes shape. The batch is
 * only the thread running through them: rows sharing a `batch_id` were asked
 * for together, are decided together in one action, and their loans can still
 * be handed back one at a time.
 *
 * Null everywhere it is not set, so every row written before this migration is
 * a batch of one and behaves exactly as it always has.
 * ------------------------------------------------------------------ */

alter table public.tool_requests
  add column if not exists batch_id text;

alter table public.transactions
  add column if not exists batch_id text;

create index if not exists tool_requests_batch_idx
  on public.tool_requests (batch_id)
  where batch_id is not null;

create index if not exists transactions_batch_idx
  on public.transactions (batch_id)
  where batch_id is not null;
