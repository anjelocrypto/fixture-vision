-- Forward-only fix: the accent fold table had 68 source characters but 69
-- replacement characters, which shifted the mapping for the final four
-- characters (đ, ğ, ł, ß). Isolated-database tests caught the drift.
CREATE OR REPLACE FUNCTION public.normalize_team_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        lower(translate(
          COALESCE(p_name, ''),
          'àáâãäåāăąèéêëēĕėęěìíîïĩīĭįıòóôõöøōŏőùúûüũūŭůűųçćĉċčñńņňýÿŷšśşžźżđğłß',
          'aaaaaaaaaeeeeeeeeeiiiiiiiiiooooooooouuuuuuuuuucccccnnnnyyyssszzzdgls'
        )),
        '\y(fc|afc|sc|cf|ac|ss|ssc|cd|ud|sv|fk|nk|bk|if|tc|club|city|calcio|futbol|football)\y',
        ' ', 'g'
      ),
      '[^a-z0-9]', '', 'g'
    ), '');
$function$;

REVOKE ALL ON FUNCTION public.normalize_team_name(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_team_name(text) TO service_role;