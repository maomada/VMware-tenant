-- Make vcenter_folder_path optional and enforce unique project names per user.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_user_id_vcenter_folder_path_key;
ALTER TABLE projects ALTER COLUMN vcenter_folder_path DROP NOT NULL;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_user_id_name_key;
ALTER TABLE projects ADD CONSTRAINT projects_user_id_name_key UNIQUE (user_id, name);
