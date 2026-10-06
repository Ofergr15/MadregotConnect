CREATE OR REPLACE FUNCTION public.move_url_leftovers(old_host text)
RETURNS TABLE(tbl text, col text, n bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; c bigint;
BEGIN
  FOR r IN SELECT cl.table_schema s, cl.table_name t, cl.column_name cn FROM information_schema.columns cl
           JOIN information_schema.tables tb ON tb.table_schema = cl.table_schema AND tb.table_name = cl.table_name AND tb.table_type = 'BASE TABLE'
           WHERE (cl.table_schema = 'public' OR (cl.table_schema = 'auth' AND cl.table_name = 'users' AND cl.column_name IN ('raw_user_meta_data','raw_app_meta_data')))
             AND cl.data_type IN ('text','character varying','jsonb','json','ARRAY')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I WHERE %I::text LIKE %L', r.s, r.t, r.cn, '%' || old_host || '%') INTO c;
    IF c > 0 THEN tbl := r.s || '.' || r.t; col := r.cn; n := c; RETURN NEXT; END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.move_url_leftovers(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_url_leftovers(text) TO service_role;
