-- Adds a per-record cultural advisory flag for First Nations cultural material.
-- See the ICIP section of CLAUDE.md and GitHub issue #11.

alter table public.artworks
  add column if not exists cultural_notice boolean not null default false;

comment on column public.artworks.cultural_notice is
  'True when a record carries First Nations cultural material that needs a content advisory.';
