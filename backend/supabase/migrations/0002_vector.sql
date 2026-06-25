-- 0002_vector.sql — pgvector columns + similarity indexes (T008)
-- Embedding dimension MUST match the chosen Gemini embedding model output.
-- Default 768 (text-embedding-004 style); change here AND in shared/embeddings.ts together.

alter table comment   add column if not exists embedding vector(768);
alter table narrative add column if not exists centroid  vector(768);

-- Approximate-nearest-neighbour indexes for clustering / similarity (R6).
-- HNSW chosen for recall at low-thousands scale; cosine distance.
create index if not exists idx_comment_embedding
  on comment using hnsw (embedding vector_cosine_ops);

create index if not exists idx_narrative_centroid
  on narrative using hnsw (centroid vector_cosine_ops);
