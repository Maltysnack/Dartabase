// Row shapes for the Dartabase tables. These mirror the database schema in
// supabase/migrations/0001_initial_schema.sql.

export interface Artist {
  id: string;
  name: string;
  slug: string | null;
  sort_name: string | null;
  also_known_as: string[];
  birth_year: number | null;
  death_year: number | null;
  nationality: string | null;
  gender: string | null;
  bio: string | null;
  wikidata_id: string | null;
  gnd_id: string | null;
  image_url: string | null;
  movements: string[];
  source: string;
  source_url: string | null;
  website_url: string | null;
  wikipedia_url: string | null;
  gallery_url: string | null;
  merged_into: string | null;
}

export interface Institution {
  id: string;
  name: string;
  slug: string | null;
  type: string;
  city: string | null;
  country: string | null;
  founded_year: number | null;
  acronyms: string[];
  website: string | null;
  wikidata_id: string | null;
  source: string;
  source_url: string | null;
  merged_into: string | null;
}

export interface Artwork {
  id: string;
  title: string;
  slug: string | null;
  artist_id: string | null;
  date_text: string | null;
  date_year: number | null;
  medium: string | null;
  materials: string[];
  dimensions: string | null;
  current_institution_id: string | null;
  credit_line: string | null;
  image_url: string | null;
  image_license: string | null;
  iiif_manifest_url: string | null;
  wikidata_id: string | null;
  cultural_notice: boolean;
  cultural_attribution: string | null;
  department: string | null;
  classification: string | null;
  source: string;
  source_id: string | null;
  source_url: string | null;
}

// An artwork with its artist and institution fully resolved.
export interface ArtworkFull extends Artwork {
  artist: Artist | null;
  institution: Institution | null;
}
