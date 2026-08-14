-- Configurable department page, linked from the Student navigation.
--
-- Students get a menu/navigation link to the department's Facebook page or
-- external department page. The address is laboratory configuration — set once
-- by an administrator in Settings → Laboratory — never a hardcoded value in the
-- app, so the link stays correct without a redeploy when the department's page
-- changes.
--
-- Empty by default (''): until an administrator provides the real address,
-- the link is simply not shown, so there is no placeholder or mock data in the
-- shipped product.

alter table public.settings
  add column department_url text not null default '';