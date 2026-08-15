/* ------------------------------------------------------------------ *
 * 0017 — where a requested tool will be collected
 *
 * One column on `tool_requests`, and nothing else:
 *
 *   collection_location  one point, captured when the request was raised
 *
 * A request is the step before a loan, and the collection point a student
 * gives is where they mean to pick the tool up — the same shape of reading
 * `0008` added to `transactions`. It is optional and it is a single point,
 * not a track:
 *
 *   { "lat": 12.7, "lng": 121.4, "accuracy": 18.4, "capturedAt": "…Z",
 *     "capturedById": "…", "capturedByName": "…" }
 *
 * Nothing about deciding a request changes, and the actual handover still
 * records its own point on the loan at the counter. Existing rows get a null
 * location, so every request written before this migration stays valid and
 * readable.
 * ------------------------------------------------------------------ */

alter table public.tool_requests
  add column if not exists collection_location jsonb;
