BEGIN;

ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS create_time TIMESTAMP;
ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS end_time TIMESTAMP;
ALTER TABLE virtual_machines ADD COLUMN IF NOT EXISTS owner VARCHAR(100);

UPDATE virtual_machines
SET create_time = COALESCE(create_time, bound_at, created_at)
WHERE create_time IS NULL;

CREATE INDEX IF NOT EXISTS idx_vm_create_time ON virtual_machines(create_time);
CREATE INDEX IF NOT EXISTS idx_vm_end_time ON virtual_machines(end_time);
CREATE INDEX IF NOT EXISTS idx_vm_owner ON virtual_machines(owner);

COMMIT;
