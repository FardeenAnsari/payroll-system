-- Migration: Fix enum type mismatch for employees.role
-- Safe steps: convert column to text, create new enum, cast back to enum, set NOT NULL
-- Backup your data before running this migration.

BEGIN;

-- 1) Inspect current distinct role values (run manually before applying)
-- SELECT DISTINCT role FROM employees;

-- 2) Temporarily convert role column to text to avoid cross-enum casting issues
ALTER TABLE employees ALTER COLUMN role TYPE text USING role::text;

-- 3) Create the enum type Sequelize expects if it does not exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_employees_role') THEN
    CREATE TYPE public.enum_employees_role AS ENUM ('salaried', 'hourly');
  END IF;
END$$;

-- 4) Cast the text column into the new enum type
ALTER TABLE employees ALTER COLUMN role TYPE public.enum_employees_role USING (role::public.enum_employees_role);

-- 5) Apply NOT NULL constraint if desired (the model uses allowNull: false)
ALTER TABLE employees ALTER COLUMN role SET NOT NULL;

COMMIT;

-- If any step fails because of unexpected role values, inspect and normalize values like:
-- SELECT DISTINCT role FROM employees WHERE role NOT IN ('salaried','hourly');
-- UPDATE employees SET role = 'salaried' WHERE role = 'Salary';

-- Notes:
-- - You can run this file in psql: psql "$DATABASE_URL" -f 20251102_fix_enum_role.sql
-- - Or paste the contents into Supabase SQL editor and run there.
