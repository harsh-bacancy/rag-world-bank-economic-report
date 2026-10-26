-- GEP Navigator — Supabase schema (optional store; the app runs on the local JSON index without it).
-- Run once in the Supabase SQL editor, then: STORE=supabase npm run db:push
-- Tables are prefixed gep_ so they can live beside other projects in the same database.

create extension if not exists vector;

create table if not exists gep_meta (
  key   text primary key,
  value jsonb not null
);

create table if not exists gep_sections (
  id         text primary key,
  parent_id  text,
  level      int  not null,
  title      text not null,
  path       text[] not null,
  chapter    text not null,              -- FM | ES | 1..4 | SA | BM
  region     text,                       -- EAP | ECA | LAC | MNA | SAR | SSA
  box_id     text,                       -- "1.1"
  kind       text not null,
  pdf_start  int  not null,
  pdf_end    int  not null
);

create table if not exists gep_parents (
  id          text primary key,
  section_id  text not null references gep_sections(id) on delete cascade,
  type        text not null,             -- paragraph | figure | table
  text        text not null,
  pdf_start   int  not null,
  pdf_end     int  not null,
  token_count int  not null
);

create table if not exists gep_chunks (
  id             text primary key,
  parent_id      text not null references gep_parents(id) on delete cascade,
  section_id     text not null references gep_sections(id) on delete cascade,
  type           text not null,
  kind           text not null,
  chapter        text not null,
  region         text,
  box_id         text,
  heading_path   text not null,
  text           text not null,          -- verbatim: citations verify against this
  retrieval_text text not null,          -- heading path + text + tables read as prose
  pdf_start      int  not null,
  pdf_end        int  not null,
  printed_start  text not null,
  printed_end    text not null,
  token_count    int  not null,
  embedding      vector(768),
  fts            tsvector generated always as (to_tsvector('english', retrieval_text)) stored
);

create table if not exists gep_naive_chunks (
  id            text primary key,
  text          text not null,
  pdf_start     int  not null,
  pdf_end       int  not null,
  printed_start text not null,
  embedding     vector(768),
  fts           tsvector generated always as (to_tsvector('english', text)) stored
);

create table if not exists gep_table_cells (
  id           bigserial primary key,
  table_id     text not null,
  caption      text not null,
  chunk_id     text references gep_chunks(id) on delete set null,
  row_label    text not null,
  row_group    text,
  region       text,
  col          text not null,
  is_revision  boolean not null,
  raw          text not null,
  value        double precision,
  pdf_page     int not null,
  printed_page text not null
);

create table if not exists gep_messages (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  question    text not null,
  answer      text not null,
  refused     boolean not null,
  citations   jsonb not null default '[]',
  rejected    int not null default 0,
  route       jsonb,
  mode        text not null
);

create table if not exists gep_traces (
  id          bigserial primary key,
  message_id  bigint references gep_messages(id) on delete cascade,
  created_at  timestamptz not null default now(),
  retrieved   jsonb not null,
  latency_ms  int not null
);

create index if not exists gep_chunks_embedding_idx on gep_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists gep_chunks_fts_idx       on gep_chunks using gin (fts);
create index if not exists gep_chunks_filter_idx    on gep_chunks (kind, chapter, region, box_id);
create index if not exists gep_naive_embedding_idx  on gep_naive_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists gep_naive_fts_idx        on gep_naive_chunks using gin (fts);
create index if not exists gep_cells_lookup_idx     on gep_table_cells (table_id, row_label);

-- Hybrid search inside metadata filters: full-text rank + cosine rank, fused with Reciprocal Rank Fusion.
-- Only ranks matter, so ts_rank_cd and cosine distance never need a common scale. k = 50 (same as the local store).
-- p_query_embedding may be null (no API key): the function then returns the keyword channel alone.
create or replace function gep_hybrid_search(
  p_query_text      text,
  p_query_embedding vector(768),
  p_match_count     int     default 30,
  p_regions         text[]  default null,
  p_chapter         text    default null,
  p_box             text    default null,
  p_kinds           text[]  default array['foreword','executive_summary','chapter_summary','body','box','figure','table','annex','statistical_appendix'],
  p_rrf_k           int     default 50,
  p_channel         text    default 'hybrid'          -- hybrid | keyword | dense
)
returns table (chunk_id text, rrf_score float, fts_rank int, sem_rank int)
language sql stable
as $$
with allowed as (
  select c.id, c.fts, c.embedding
  from gep_chunks c
  where c.kind = any(p_kinds)
    and (p_regions is null or c.region = any(p_regions))
    and (p_chapter is null or c.chapter = p_chapter)
    and (p_box is null or c.box_id = p_box)
),
full_text as (
  select id, row_number() over (order by ts_rank_cd(fts, websearch_to_tsquery('english', p_query_text)) desc) as rank_ix
  from allowed
  where p_channel <> 'dense' and fts @@ websearch_to_tsquery('english', p_query_text)
  order by rank_ix
  limit greatest(p_match_count, 30) * 2
),
semantic as (
  select id, row_number() over (order by embedding <=> p_query_embedding) as rank_ix
  from allowed
  where p_channel <> 'keyword' and p_query_embedding is not null and embedding is not null
  order by rank_ix
  limit greatest(p_match_count, 30) * 2
)
select
  coalesce(f.id, s.id) as chunk_id,
  coalesce(1.0 / (p_rrf_k + f.rank_ix), 0.0) + coalesce(1.0 / (p_rrf_k + s.rank_ix), 0.0) as rrf_score,
  f.rank_ix::int as fts_rank,
  s.rank_ix::int as sem_rank
from full_text f
full outer join semantic s on f.id = s.id
order by rrf_score desc
limit p_match_count;
$$;

-- The naive baseline: no filters, no structure.
create or replace function gep_naive_search(
  p_query_text      text,
  p_query_embedding vector(768),
  p_match_count     int  default 30,
  p_channel         text default 'dense'
)
returns table (chunk_id text, rrf_score float, fts_rank int, sem_rank int)
language sql stable
as $$
with full_text as (
  select id, row_number() over (order by ts_rank_cd(fts, websearch_to_tsquery('english', p_query_text)) desc) as rank_ix
  from gep_naive_chunks
  where p_channel <> 'dense' and fts @@ websearch_to_tsquery('english', p_query_text)
  limit greatest(p_match_count, 30) * 2
),
semantic as (
  select id, row_number() over (order by embedding <=> p_query_embedding) as rank_ix
  from gep_naive_chunks
  where p_channel <> 'keyword' and p_query_embedding is not null and embedding is not null
  limit greatest(p_match_count, 30) * 2
)
select coalesce(f.id, s.id), coalesce(1.0 / (50 + f.rank_ix), 0.0) + coalesce(1.0 / (50 + s.rank_ix), 0.0), f.rank_ix::int, s.rank_ix::int
from full_text f full outer join semantic s on f.id = s.id
order by 2 desc
limit p_match_count;
$$;
