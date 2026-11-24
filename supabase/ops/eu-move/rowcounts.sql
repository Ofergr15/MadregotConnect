-- EU move — exact row counts, read-only. Run on BOTH projects and diff:
--   psql "$TOKYO_DB_URL" -X -q -A -t -f rowcounts.sql > counts-tokyo.txt
--   psql "$EU_DB_URL"    -X -q -A -t -f rowcounts.sql > counts-eu.txt
--   diff counts-tokyo.txt counts-eu.txt
-- Output: one line per item, "kind|name|count", sorted, nothing project-specific in it.
-- SELECT only; the transaction is READ ONLY, so it cannot write even by mistake.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';

-- query_to_xml lets one SELECT run an exact count(*) per table without a function/DO block.
WITH t AS (
  SELECT n.nspname AS s, c.relname AS r
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public'
     OR (n.nspname = 'auth' AND c.relname IN ('users', 'identities', 'refresh_tokens', 'sessions', 'mfa_factors'))
)
SELECT line FROM (
  SELECT 'table|' || s || '.' || r || '|' ||
         (xpath('/row/n/text()',
                query_to_xml(format('select count(*) as n from %I.%I', s, r), false, true, '')))[1]::text AS line
  FROM t
  UNION ALL
  SELECT 'bucket|' || b.id || '|public=' || b.public::text
  FROM storage.buckets b
  UNION ALL
  SELECT 'objects|' || b.id || '|' || count(o.id)::text
  FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id
  GROUP BY b.id
  UNION ALL
  SELECT 'bytes|' || b.id || '|' || coalesce(sum((o.metadata->>'size')::bigint), 0)::text
  FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id
  GROUP BY b.id
) x
ORDER BY line;

ROLLBACK;
