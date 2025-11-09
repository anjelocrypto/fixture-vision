DO $$
DECLARE
  seq_name text;
BEGIN
  -- find an existing sequence bound to countries.id (works for serial/identity)
  SELECT pg_get_serial_sequence('public.countries','id') INTO seq_name;

  IF seq_name IS NULL THEN
    -- no sequence/identity default; create one and set as default
    PERFORM 1 FROM pg_class WHERE relkind='S' AND relname='countries_id_seq';
    IF NOT FOUND THEN
      EXECUTE 'CREATE SEQUENCE public.countries_id_seq';
    END IF;

    EXECUTE $q$SELECT setval('public.countries_id_seq',
             COALESCE((SELECT MAX(id) FROM public.countries),0))$q$;

    EXECUTE $q$ALTER TABLE public.countries
             ALTER COLUMN id SET DEFAULT nextval('public.countries_id_seq')$q$;

    EXECUTE $q$ALTER SEQUENCE public.countries_id_seq
             OWNED BY public.countries.id$q$;

  ELSE
    -- there is already a sequence/identity; just align it
    EXECUTE format(
      'SELECT setval(%L, COALESCE((SELECT MAX(id) FROM public.countries),0))',
      seq_name
    );
  END IF;
END$$;

WITH to_add(code, name) AS (
  VALUES
    ('GB','United Kingdom'),
    ('ID','Indonesia'),
    ('ZA','South Africa'),
    ('KR','Korea, Republic of'),
    ('SA','Saudi Arabia'),
    ('AE','United Arab Emirates'),
    ('CZ','Czech Republic')
)
INSERT INTO public.countries (code, name)
SELECT t.code, t.name
FROM to_add t
LEFT JOIN public.countries c ON c.code = t.code
WHERE c.code IS NULL
RETURNING id, code, name;