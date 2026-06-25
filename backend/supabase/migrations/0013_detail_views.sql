-- 0013_detail_views.sql — read-only views backing the cadre drill-down page.
-- (Favourable-narrative detail reuses narrative_board + the comment table directly.)
-- Both views are anonymized: they expose comment text/sentiment but NEVER commenter_hash
-- (Principle III / FR-008), and run with security_invoker so staff RLS applies.

-- Narratives a cadre appears in, with how many of that cadre's comments fall in each.
create or replace view cadre_narrative as
select
  cad.id as cadre_id,
  n.id as narrative_id,
  n.stance,
  n.theme_summary,
  n.volume,
  count(*) as cadre_comment_count
from cadre cad
join connected_account ca on ca.cadre_id = cad.id and ca.consent_status = 'connected'
join post p on p.connected_account_id = ca.id
join comment cm on cm.post_id = p.id and cm.narrative_id is not null
join narrative n on n.id = cm.narrative_id
group by cad.id, n.id, n.stance, n.theme_summary, n.volume;
alter view cadre_narrative set (security_invoker = on);

-- Anonymized example comments on a cadre's own posts (no identity columns).
create or replace view cadre_comment as
select
  cad.id as cadre_id,
  cm.body,
  cm.sentiment,
  cm.sentiment_confidence,
  cm.language,
  cm.ingested_at,
  cm.narrative_id
from cadre cad
join connected_account ca on ca.cadre_id = cad.id and ca.consent_status = 'connected'
join post p on p.connected_account_id = ca.id
join comment cm on cm.post_id = p.id;
alter view cadre_comment set (security_invoker = on);
