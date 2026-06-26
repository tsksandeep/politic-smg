-- 0002_vector.sql — pgvector columns + HNSW indexes (768-dim).
-- EMBED_DIM in shared/embeddings.ts MUST equal the vector(...) dimension here (768).
-- Captions, transcripts, and comments embed into the SAME space so they cluster together.

alter table post             add column if not exists caption_embedding    vector(768);
alter table media_transcript add column if not exists transcript_embedding vector(768);
alter table comment          add column if not exists embedding            vector(768);
alter table narrative        add column if not exists centroid             vector(768);

-- HNSW cosine indexes for similarity search / clustering. Partial where not null keeps them lean.
create index if not exists idx_post_caption_hnsw
  on post using hnsw (caption_embedding vector_cosine_ops) where caption_embedding is not null;
create index if not exists idx_transcript_hnsw
  on media_transcript using hnsw (transcript_embedding vector_cosine_ops) where transcript_embedding is not null;
create index if not exists idx_comment_embedding_hnsw
  on comment using hnsw (embedding vector_cosine_ops) where embedding is not null;
create index if not exists idx_narrative_centroid_hnsw
  on narrative using hnsw (centroid vector_cosine_ops) where centroid is not null;
