-- Rôle PostgreSQL RESTREINT de l'application (production). Voir docs/04-mise-en-service.md.
--
-- Deux rôles :
--   * propriétaire (celui des migrations : pnpm db:deploy) : crée et modifie le schéma ;
--   * application (DATABASE_URL du serveur web et de la tâche planifiée) : lit et écrit les données,
--     SANS TRUNCATE (qui contournerait les triggers d'ajout seul du journal d'audit, des encaissements et
--     des historiques), sans droit de créer ou modifier des tables, et sans être propriétaire de rien.
--
-- Idempotent. À lancer par le propriétaire, connecté à la base, après la première migration :
--   psql "<URL du propriétaire>" -v app_role=systelec_app -v app_password="$APP_DB_PASSWORD" -f scripts/ops/app-role.sql
-- Le mot de passe est passé en variable (jamais écrit dans un fichier versionné).

\set ON_ERROR_STOP on

SELECT set_config('app.role_name', :'app_role', false) IS NOT NULL AS role_fixe;
SELECT set_config('app.role_password', :'app_password', false) IS NOT NULL AS mot_de_passe_fixe;

DO $$
DECLARE
  role_name text := current_setting('app.role_name');
  role_password text := current_setting('app.role_password');
BEGIN
  IF length(role_password) < 24 THEN
    RAISE EXCEPTION 'mot de passe du rôle applicatif trop court (24 caractères au moins)';
  END IF;
  IF role_name = current_user THEN
    RAISE EXCEPTION 'le rôle applicatif doit être distinct du propriétaire (%)', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name, role_password);
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', role_name, role_password);
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), role_name);
  -- Le schéma public n'accepte plus de création d'objets par les autres rôles.
  EXECUTE 'REVOKE CREATE ON SCHEMA public FROM PUBLIC';
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', role_name);
  -- Données : lecture et écriture ; jamais TRUNCATE, REFERENCES ni TRIGGER.
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', role_name);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', role_name);
  -- L'historique des migrations reste réservé au propriétaire.
  EXECUTE format('REVOKE ALL ON TABLE public._prisma_migrations FROM %I', role_name);
  -- Tables et séquences créées par les migrations futures : mêmes droits, automatiquement.
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', current_user, role_name);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', current_user, role_name);
END
$$;

SELECT set_config('app.role_password', '', false) = '' AS mot_de_passe_efface;

-- Contrôle : aucun droit TRUNCATE ni de création pour le rôle applicatif.
SELECT :'app_role' AS role_applicatif,
       (SELECT count(*) FROM information_schema.table_privileges WHERE grantee = :'app_role' AND privilege_type = 'TRUNCATE') AS droits_truncate,
       has_schema_privilege(:'app_role', 'public', 'CREATE') AS peut_creer_des_tables;
