BEGIN;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_code VARCHAR(50);

UPDATE projects
SET project_code = 'PROJ-' || LPAD(id::text, 6, '0')
WHERE project_code IS NULL OR project_code = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_project_code_unique'
  ) THEN
    ALTER TABLE projects ADD CONSTRAINT projects_project_code_unique UNIQUE (project_code);
  END IF;
END $$;

ALTER TABLE projects ALTER COLUMN project_code SET NOT NULL;

COMMIT;
