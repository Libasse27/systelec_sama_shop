-- Volume de données pour les tests de performance (scripts/perf/load-test.js). JAMAIS en production :
-- à lancer seulement sur une base jetable, en confirmant son nom (garde-fou ci-dessous).
--   psql "<URL base jetable>" -v confirm_db=<nom de cette base> -v categories=20 -v per_category=250 -f scripts/perf/volume.sql
-- Crée des catégories « [PERF] » et leurs produits publiés (une version, un stock), idempotent par slug.

\set ON_ERROR_STOP on
SELECT set_config('perf.confirm_db', :'confirm_db', false) IS NOT NULL AS confirmation_lue;

DO $$
BEGIN
  IF current_setting('perf.confirm_db') <> current_database() THEN
    RAISE EXCEPTION 'garde-fou : confirm_db (%) ne correspond pas à la base connectée (%)', current_setting('perf.confirm_db'), current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM users u JOIN user_roles ur ON ur."userId" = u.id JOIN roles r ON r.id = ur."roleId"
             WHERE r.code = 'SUPER_ADMIN' AND u.email NOT LIKE '%@example.sn') THEN
    RAISE EXCEPTION 'garde-fou : un administrateur principal réel existe, cette base ne semble pas jetable';
  END IF;
END $$;

INSERT INTO categories (id, name, slug, description, position, "isActive", "updatedAt")
SELECT 'perfcat' || c, '[PERF] Catégorie ' || c, 'perf-categorie-' || c, 'Catégorie de test de charge', 1000 + c, true, now()
  FROM generate_series(1, :categories) AS c
ON CONFLICT (slug) DO NOTHING;

INSERT INTO products (id, "categoryId", name, slug, "shortDescription", description, status, "isFeatured", "publishedAt", specs, "updatedAt")
SELECT 'perfprod' || c || '_' || p, 'perfcat' || c,
       '[PERF] Caméra IP ' || c || '-' || p || ' Hikvision 4 MP vision nocturne',
       'perf-produit-' || c || '-' || p,
       'Produit de test de charge ' || p,
       repeat('Description détaillée du produit de test de charge. ', 20),
       'PUBLISHED', (p % 50 = 0), now() - (p || ' minutes')::interval,
       '[{"label": "Résolution", "value": "4 MP"}, {"label": "Portée IR", "value": "30 m"}]'::jsonb, now()
  FROM generate_series(1, :categories) AS c, generate_series(1, :per_category) AS p
ON CONFLICT (slug) DO NOTHING;

INSERT INTO product_variants (id, "productId", sku, name, price, "costPrice", "isDefault", "updatedAt")
SELECT 'perfvar_' || pr.id, pr.id, 'PERF-' || upper(substr(md5(pr.id), 1, 10)), 'Standard',
       10000 + (abs(hashtext(pr.id)) % 200) * 500, 8000, true, now()
  FROM products pr WHERE pr.slug LIKE 'perf-produit-%'
ON CONFLICT (sku) DO NOTHING;

INSERT INTO inventories (id, "variantId", "onHand", reserved, "alertThreshold", "updatedAt")
SELECT 'perfinv_' || v.id, v.id, 25, 0, 2, now()
  FROM product_variants v WHERE v.sku LIKE 'PERF-%'
ON CONFLICT ("variantId") DO NOTHING;

ANALYZE categories, products, product_variants, inventories;

SELECT (SELECT count(*) FROM products WHERE slug LIKE 'perf-produit-%') AS produits_perf,
       (SELECT count(*) FROM products WHERE status = 'PUBLISHED') AS produits_publies;
