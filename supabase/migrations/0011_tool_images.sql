/* ------------------------------------------------------------------ *
 * 0011 — an optional picture for a tool
 *
 * One column on `tools` and one storage bucket, and nothing else:
 *
 *   image_url   the public URL of the picture in the `tool-images` bucket,
 *               or null for a tool that has none
 *
 * The picture is optional by design. Every tool written before this migration
 * keeps working with `image_url` null, and the inventory falls back to the same
 * icon tile it has always drawn — nothing in the application requires a photo.
 *
 * The file itself lives in Supabase Storage rather than in the row: a bucket is
 * what serves an image well (a CDN URL, a byte range, a browser cache), and it
 * keeps `select tools` the small query it is today.
 * ------------------------------------------------------------------ */

alter table public.tools
  add column if not exists image_url text;

-- A URL, not a payload. The cap is what stops a compromised client using a text
-- column as image hosting, and the prefix keeps the value pointing at storage.
alter table public.tools
  drop constraint if exists tools_image_url_shape;
alter table public.tools
  add constraint tools_image_url_shape
  check (
    image_url is null
    or (char_length(image_url) <= 2048 and image_url like 'http%')
  );

/* ------------------------------------------------------------------ *
 * The bucket
 *
 * Public read: a tool photo is inventory signage, shown on the tools page to
 * everyone who may already read the tool record, and a public object URL is
 * what lets an installed PWA cache it like any other image.
 *
 * Writes follow the tool record's own permission — the staff who may edit the
 * inventory, resolved from the caller's own `profiles` row exactly as every
 * other policy in 0002 does.
 * ------------------------------------------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tool-images',
  'tool-images',
  true,
  5242880,                                  -- 5 MB, matched by the client
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "tool images are readable" on storage.objects;
create policy "tool images are readable"
  on storage.objects for select
  using (bucket_id = 'tool-images');

-- `is_staff()` and `is_active()` are the helpers 0002 already resolves the
-- caller's role with, so a picture follows the same rule as the tool record it
-- belongs to rather than inventing a second one.
drop policy if exists "staff upload tool images" on storage.objects;
create policy "staff upload tool images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'tool-images' and public.is_active() and public.is_staff());

drop policy if exists "staff replace tool images" on storage.objects;
create policy "staff replace tool images"
  on storage.objects for update to authenticated
  using (bucket_id = 'tool-images' and public.is_active() and public.is_staff())
  with check (bucket_id = 'tool-images' and public.is_active() and public.is_staff());

drop policy if exists "staff delete tool images" on storage.objects;
create policy "staff delete tool images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'tool-images' and public.is_active() and public.is_staff());
