-- Dartabase schema.
--
-- The local Postgres is a workbench: ingestion scripts write to it, the export
-- script reads from it, and the site itself never touches it. This is the whole
-- schema in one file (artworks, artists, institutions, exhibitions, and the
-- triggers that keep search vectors and slugs up to date).

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

--
-- Name: artists_tsv(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.artists_tsv() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.search_vector := to_tsvector('english',
    coalesce(new.name,'') || ' ' ||
    array_to_string(new.also_known_as, ' ') || ' ' ||
    coalesce(new.nationality,'') || ' ' ||
    coalesce(new.bio,''));
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end; $$;


--
-- Name: artworks_tsv(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.artworks_tsv() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.medium, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.date_text, '')), 'D');
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END; $$;


--
-- Name: auto_slug(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_slug(input text, max_len integer DEFAULT 80) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  select regexp_replace(
    substring(
      regexp_replace(
        regexp_replace(lower(unaccent(input)), '[^a-z0-9]+', '-', 'g'),
        '^-+|-+$', '', 'g'
      )
      from 1 for max_len
    ),
    '-+$', ''
  )
$_$;


--
-- Name: exhibitions_tsv(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.exhibitions_tsv() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.search_vector := to_tsvector('english',
    coalesce(new.title,'') || ' ' || coalesce(new.description,''));
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end; $$;


--
-- Name: institutions_set_search_blob(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.institutions_set_search_blob() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.search_blob := new.name ||
    case
      when array_length(new.acronyms, 1) is null then ''
      else ' ' || array_to_string(new.acronyms, ' ')
    end;
  return new;
end$$;


--
-- Name: institutions_tsv(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.institutions_tsv() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.search_vector := to_tsvector('english',
    coalesce(new.name,'') || ' ' || coalesce(new.city,'') || ' ' || coalesce(new.country,''));
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end; $$;


--
-- Name: sync_artwork_has_exhibition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_artwork_has_exhibition() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    update artworks set has_exhibition = true where id = new.artwork_id;
  elsif tg_op = 'DELETE' then
    update artworks
    set has_exhibition = exists (
      select 1 from exhibition_artworks ea where ea.artwork_id = old.artwork_id
    )
    where id = old.artwork_id;
  end if;
  return null;
end;
$$;


--
-- Name: sync_artwork_last_exhibition_year(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_artwork_last_exhibition_year() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_artwork_id uuid;
BEGIN
  v_artwork_id := CASE TG_OP WHEN 'DELETE' THEN OLD.artwork_id ELSE NEW.artwork_id END;
  UPDATE public.artworks
  SET last_exhibition_year = (
    SELECT MAX(EXTRACT(YEAR FROM e.start_date)::int)
    FROM exhibition_artworks ea
    JOIN exhibitions e ON e.id = ea.exhibition_id
    WHERE ea.artwork_id = v_artwork_id AND e.start_date IS NOT NULL
  )
  WHERE id = v_artwork_id;
  RETURN NULL;
END;
$$;


--
-- Name: trg_set_artist_slug(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_set_artist_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  base text;
begin
  if new.slug is not null then
    return new;
  end if;
  base := auto_slug(coalesce(new.name, ''), 80);
  if base = '' then
    return new;
  end if;
  new.slug := unique_slug_artists(base);
  return new;
end;
$$;


--
-- Name: trg_set_artwork_slug(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_set_artwork_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
declare
  base text;
  title_part text;
  artist_part text;
  year_part text;
  artist_name text;
begin
  if new.slug is not null then
    return new;
  end if;

  title_part := regexp_replace(auto_slug(coalesce(new.title, ''), 60), '-+$', '');

  if new.artist_id is not null then
    select name into artist_name from public.artists where id = new.artist_id;
    if found and artist_name is not null then
      artist_part := regexp_replace(auto_slug(artist_name, 40), '-+$', '');
    end if;
  end if;

  if new.date_year is not null then
    year_part := new.date_year::text;
  end if;

  base := title_part;
  if artist_part is not null and artist_part <> '' then
    base := base || '-' || artist_part;
  end if;
  if year_part is not null then
    base := base || '-' || year_part;
  end if;

  base := regexp_replace(substring(base from 1 for 80), '-+$', '');

  if base = '' then
    return new;
  end if;

  new.slug := unique_slug_artworks(base);
  return new;
end;
$_$;


--
-- Name: trg_set_institution_slug(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_set_institution_slug() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  base text;
begin
  if new.slug is not null then
    return new;
  end if;
  base := auto_slug(coalesce(new.name, ''), 80);
  if base = '' then
    return new;
  end if;
  new.slug := unique_slug_institutions(base);
  return new;
end;
$$;


--
-- Name: unique_slug_artists(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unique_slug_artists(base text) RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  candidate text := base;
  n integer := 2;
begin
  while exists (select 1 from public.artists where slug = candidate) loop
    candidate := base || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end;
$$;


--
-- Name: unique_slug_artworks(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unique_slug_artworks(base text) RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  candidate text := base;
  n integer := 2;
begin
  while exists (select 1 from public.artworks where slug = candidate) loop
    candidate := base || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end;
$$;


--
-- Name: unique_slug_institutions(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unique_slug_institutions(base text) RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  candidate text := base;
  n integer := 2;
begin
  while exists (select 1 from public.institutions where slug = candidate) loop
    candidate := base || '-' || n;
    n := n + 1;
  end loop;
  return candidate;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: artists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    sort_name text,
    also_known_as text[] DEFAULT '{}'::text[] NOT NULL,
    birth_year integer,
    death_year integer,
    nationality text,
    bio text,
    wikidata_id text,
    source text NOT NULL,
    source_id text,
    source_url text,
    search_vector tsvector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    merged_into uuid,
    image_url text,
    movements text[] DEFAULT '{}'::text[] NOT NULL,
    gnd_id text,
    website_url text,
    wikipedia_url text,
    gallery_url text,
    slug text,
    gender text,
    CONSTRAINT artists_gender_check CHECK ((gender = ANY (ARRAY['female'::text, 'male'::text, 'non-binary'::text])))
);


--
-- Name: artworks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artworks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    artist_id uuid,
    date_text text,
    date_year integer,
    medium text,
    materials text[] DEFAULT '{}'::text[] NOT NULL,
    dimensions text,
    current_institution_id uuid,
    credit_line text,
    image_url text,
    image_license text,
    wikidata_id text,
    source text NOT NULL,
    source_id text,
    source_url text,
    search_vector tsvector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cultural_notice boolean DEFAULT false NOT NULL,
    iiif_manifest_url text,
    slug text,
    cultural_attribution text,
    medium_bucket text,
    has_exhibition boolean DEFAULT false NOT NULL,
    last_exhibition_year integer,
    department text,
    classification text
);


--
-- Name: exhibition_artworks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exhibition_artworks (
    exhibition_id uuid NOT NULL,
    artwork_id uuid NOT NULL
);


--
-- Name: exhibitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exhibitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    institution_id uuid,
    start_date date,
    end_date date,
    description text,
    source text NOT NULL,
    source_id text,
    source_url text,
    search_vector tsvector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: institutions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.institutions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'museum'::text NOT NULL,
    city text,
    country text,
    website text,
    wikidata_id text,
    source text NOT NULL,
    source_id text,
    source_url text,
    search_vector tsvector,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    merged_into uuid,
    founded_year integer,
    acronyms text[] DEFAULT '{}'::text[] NOT NULL,
    search_blob text,
    slug text,
    CONSTRAINT institutions_type_check CHECK ((type = ANY (ARRAY['museum'::text, 'gallery'::text, 'other'::text])))
);


--
-- Name: artists artists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_pkey PRIMARY KEY (id);


--
-- Name: artists artists_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_slug_key UNIQUE (slug);


--
-- Name: artists artists_source_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_source_source_id_key UNIQUE (source, source_id);


--
-- Name: artworks artworks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artworks
    ADD CONSTRAINT artworks_pkey PRIMARY KEY (id);


--
-- Name: artworks artworks_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artworks
    ADD CONSTRAINT artworks_slug_key UNIQUE (slug);


--
-- Name: artworks artworks_source_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artworks
    ADD CONSTRAINT artworks_source_source_id_key UNIQUE (source, source_id);


--
-- Name: exhibition_artworks exhibition_artworks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibition_artworks
    ADD CONSTRAINT exhibition_artworks_pkey PRIMARY KEY (exhibition_id, artwork_id);


--
-- Name: exhibitions exhibitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibitions
    ADD CONSTRAINT exhibitions_pkey PRIMARY KEY (id);


--
-- Name: exhibitions exhibitions_source_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibitions
    ADD CONSTRAINT exhibitions_source_source_id_key UNIQUE (source, source_id);


--
-- Name: institutions institutions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_pkey PRIMARY KEY (id);


--
-- Name: institutions institutions_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_slug_key UNIQUE (slug);


--
-- Name: institutions institutions_source_source_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_source_source_id_key UNIQUE (source, source_id);


--
-- Name: artists_gender_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artists_gender_idx ON public.artists USING btree (gender) WHERE (gender IS NOT NULL);


--
-- Name: artists_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artists_slug_idx ON public.artists USING btree (slug) WHERE (slug IS NOT NULL);


--
-- Name: artworks_cultural_attribution_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artworks_cultural_attribution_idx ON public.artworks USING btree (cultural_attribution) WHERE (cultural_attribution IS NOT NULL);


--
-- Name: artworks_has_exhibition_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artworks_has_exhibition_idx ON public.artworks USING btree (id) WHERE (has_exhibition = true);


--
-- Name: artworks_iiif_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artworks_iiif_idx ON public.artworks USING btree (id) WHERE (iiif_manifest_url IS NOT NULL);


--
-- Name: artworks_medium_bucket_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artworks_medium_bucket_idx ON public.artworks USING btree (medium_bucket);


--
-- Name: artworks_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artworks_slug_idx ON public.artworks USING btree (slug) WHERE (slug IS NOT NULL);


--
-- Name: idx_artists_canonical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artists_canonical ON public.artists USING btree (sort_name) WHERE (merged_into IS NULL);


--
-- Name: idx_artists_merged_into; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artists_merged_into ON public.artists USING btree (merged_into) WHERE (merged_into IS NOT NULL);


--
-- Name: idx_artists_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artists_name_trgm ON public.artists USING gin (name extensions.gin_trgm_ops);


--
-- Name: idx_artists_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artists_search ON public.artists USING gin (search_vector);


--
-- Name: idx_artists_sort_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artists_sort_name ON public.artists USING btree (sort_name);


--
-- Name: idx_artworks_artist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artworks_artist ON public.artworks USING btree (artist_id);


--
-- Name: idx_artworks_date_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artworks_date_year ON public.artworks USING btree (date_year);


--
-- Name: idx_artworks_institution; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artworks_institution ON public.artworks USING btree (current_institution_id);


--
-- Name: idx_artworks_last_exhibition_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artworks_last_exhibition_year ON public.artworks USING btree (last_exhibition_year) WHERE (last_exhibition_year IS NOT NULL);


--
-- Name: idx_artworks_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artworks_search ON public.artworks USING gin (search_vector);


--
-- Name: idx_artworks_title_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_artworks_title_trgm ON public.artworks USING gin (title extensions.gin_trgm_ops);


--
-- Name: idx_exhibition_artworks_artwork; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exhibition_artworks_artwork ON public.exhibition_artworks USING btree (artwork_id);


--
-- Name: idx_exhibitions_institution; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exhibitions_institution ON public.exhibitions USING btree (institution_id);


--
-- Name: idx_exhibitions_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exhibitions_search ON public.exhibitions USING gin (search_vector);


--
-- Name: idx_exhibitions_start_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exhibitions_start_date ON public.exhibitions USING btree (start_date);


--
-- Name: idx_institutions_canonical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_institutions_canonical ON public.institutions USING btree (name) WHERE (merged_into IS NULL);


--
-- Name: idx_institutions_merged_into; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_institutions_merged_into ON public.institutions USING btree (merged_into) WHERE (merged_into IS NOT NULL);


--
-- Name: idx_institutions_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_institutions_name_trgm ON public.institutions USING gin (name extensions.gin_trgm_ops);


--
-- Name: idx_institutions_search; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_institutions_search ON public.institutions USING gin (search_vector);


--
-- Name: institutions_search_blob_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX institutions_search_blob_trgm ON public.institutions USING gin (search_blob extensions.gin_trgm_ops);


--
-- Name: institutions_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX institutions_slug_idx ON public.institutions USING btree (slug) WHERE (slug IS NOT NULL);


--
-- Name: artists artists_auto_slug; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER artists_auto_slug BEFORE INSERT ON public.artists FOR EACH ROW EXECUTE FUNCTION public.trg_set_artist_slug();


--
-- Name: artworks artworks_auto_slug; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER artworks_auto_slug BEFORE INSERT ON public.artworks FOR EACH ROW EXECUTE FUNCTION public.trg_set_artwork_slug();


--
-- Name: institutions institutions_auto_slug; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER institutions_auto_slug BEFORE INSERT ON public.institutions FOR EACH ROW EXECUTE FUNCTION public.trg_set_institution_slug();


--
-- Name: institutions institutions_search_blob_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER institutions_search_blob_trg BEFORE INSERT OR UPDATE OF name, acronyms ON public.institutions FOR EACH ROW EXECUTE FUNCTION public.institutions_set_search_blob();


--
-- Name: artists trg_artists_tsv; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_artists_tsv BEFORE INSERT OR UPDATE ON public.artists FOR EACH ROW EXECUTE FUNCTION public.artists_tsv();


--
-- Name: artworks trg_artworks_tsv; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_artworks_tsv BEFORE INSERT OR UPDATE ON public.artworks FOR EACH ROW EXECUTE FUNCTION public.artworks_tsv();


--
-- Name: exhibition_artworks trg_exhibition_artworks_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_exhibition_artworks_sync AFTER INSERT OR DELETE ON public.exhibition_artworks FOR EACH ROW EXECUTE FUNCTION public.sync_artwork_has_exhibition();


--
-- Name: exhibitions trg_exhibitions_tsv; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_exhibitions_tsv BEFORE INSERT OR UPDATE ON public.exhibitions FOR EACH ROW EXECUTE FUNCTION public.exhibitions_tsv();


--
-- Name: institutions trg_institutions_tsv; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_institutions_tsv BEFORE INSERT OR UPDATE ON public.institutions FOR EACH ROW EXECUTE FUNCTION public.institutions_tsv();


--
-- Name: exhibition_artworks trg_sync_artwork_last_exhibition_year; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_artwork_last_exhibition_year AFTER INSERT OR DELETE ON public.exhibition_artworks FOR EACH ROW EXECUTE FUNCTION public.sync_artwork_last_exhibition_year();


--
-- Name: artists artists_merged_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.artists(id);


--
-- Name: artworks artworks_artist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artworks
    ADD CONSTRAINT artworks_artist_id_fkey FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE SET NULL;


--
-- Name: artworks artworks_current_institution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artworks
    ADD CONSTRAINT artworks_current_institution_id_fkey FOREIGN KEY (current_institution_id) REFERENCES public.institutions(id) ON DELETE SET NULL;


--
-- Name: exhibition_artworks exhibition_artworks_artwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibition_artworks
    ADD CONSTRAINT exhibition_artworks_artwork_id_fkey FOREIGN KEY (artwork_id) REFERENCES public.artworks(id) ON DELETE CASCADE;


--
-- Name: exhibition_artworks exhibition_artworks_exhibition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibition_artworks
    ADD CONSTRAINT exhibition_artworks_exhibition_id_fkey FOREIGN KEY (exhibition_id) REFERENCES public.exhibitions(id) ON DELETE CASCADE;


--
-- Name: exhibitions exhibitions_institution_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exhibitions
    ADD CONSTRAINT exhibitions_institution_id_fkey FOREIGN KEY (institution_id) REFERENCES public.institutions(id) ON DELETE SET NULL;


--
-- Name: institutions institutions_merged_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.institutions
    ADD CONSTRAINT institutions_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.institutions(id);


--
-- Name: artists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

--
-- Name: artworks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artworks ENABLE ROW LEVEL SECURITY;

--
-- Name: exhibition_artworks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exhibition_artworks ENABLE ROW LEVEL SECURITY;

--
-- Name: exhibitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exhibitions ENABLE ROW LEVEL SECURITY;

--
-- Name: institutions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.institutions ENABLE ROW LEVEL SECURITY;

--
-- Name: artists public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read" ON public.artists FOR SELECT TO authenticated, anon USING (true);


--
-- Name: artworks public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read" ON public.artworks FOR SELECT TO authenticated, anon USING (true);


--
-- Name: exhibition_artworks public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read" ON public.exhibition_artworks FOR SELECT TO authenticated, anon USING (true);


--
-- Name: exhibitions public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read" ON public.exhibitions FOR SELECT TO authenticated, anon USING (true);


--
-- Name: institutions public read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read" ON public.institutions FOR SELECT TO authenticated, anon USING (true);


--
-- PostgreSQL database dump complete
--


