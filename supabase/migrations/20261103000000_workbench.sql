-- AI workbench ("mesa de trabajo") and photorealistic scenes.
--
-- Additive only. A video keeps the stick-figure canvas ('ilustracion') unless
-- someone picks 'realista', in which case the workbench writes one image per
-- scene. The whole run (steps, providers, critique) lives in one jsonb column:
-- the UI polls it while the run is going, and nothing queries inside it.

alter table public.scenes add column if not exists image_url text;
alter table public.scenes add column if not exists image_prompt text;

alter table public.videos
    add column if not exists visual_style text not null default 'ilustracion';

alter table public.videos
    drop constraint if exists videos_visual_style_check;

alter table public.videos
    add constraint videos_visual_style_check
    check (visual_style in ('ilustracion', 'realista'));

alter table public.videos add column if not exists workbench jsonb;

-- Same approach as the existing buckets (tts-audio, logos, sounds): public
-- read so the render worker and the browser can fetch by URL, and no
-- storage.objects policies, because only the service role writes - access
-- control happens in the API layer. The app also creates it on first use if
-- this migration has not reached the database yet.
insert into storage.buckets (id, name, public)
values ('scene-images', 'scene-images', true)
on conflict (id) do nothing;
