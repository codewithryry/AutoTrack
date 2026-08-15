/* ------------------------------------------------------------------ *
 * 0022 — a profile photo
 *
 * One column and one bucket:
 *
 *   profiles.avatar_url   the public URL of the picture in `avatars`
 *   avatars               the bucket it lives in, one folder per account
 *
 * The picture is optional everywhere. A row with `avatar_url` null keeps the
 * initials tile the app has always drawn, so nothing requires a photo and no
 * existing account is changed by this migration.
 *
 * It is deliberately *not* part of the reviewed profile: a name or a student
 * number is a record an administrator approves, a photograph is not, so it is
 * written straight to the row by its owner. Everything else about the profile
 * review flow is untouched.
 * ------------------------------------------------------------------ */

alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles
  drop constraint if exists profiles_avatar_url_shape;

alter table public.profiles
  add constraint profiles_avatar_url_shape
  check (
    avatar_url is null
    or (char_length(avatar_url) <= 2048 and avatar_url like 'http%')
  );

/* ------------------------------------------------------------------ *
 * The bucket
 *
 * Public read, like the tool images: an avatar is shown beside a name wherever
 * that name appears, and a public object URL is what lets an installed PWA
 * cache it like any other image.
 *
 * Writes are the owner's own. Objects are stored as `<uid>/<timestamp>.<ext>`,
 * so the first path segment *is* the account — a signed-in student can write,
 * replace and delete their own picture and nobody else's. An administrator may
 * clear any, which is what account moderation already allows elsewhere.
 * ------------------------------------------------------------------ */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,                                  -- 5 MB, matched by the client
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars are readable" on storage.objects;
create policy "avatars are readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "own avatar upload" on storage.objects;
create policy "own avatar upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and public.is_active()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own avatar replace" on storage.objects;
create policy "own avatar replace"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and public.is_active()
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and public.is_active()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "own avatar delete" on storage.objects;
create policy "own avatar delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and public.is_active()
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
