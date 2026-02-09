BEGIN;

ALTER TABLE gpu_inventory
  DROP CONSTRAINT IF EXISTS gpu_inventory_status_check;

UPDATE gpu_inventory SET status = 'in_use' WHERE status = 'allocated';
UPDATE gpu_inventory SET status = 'maintenance' WHERE status = 'error';

ALTER TABLE gpu_inventory
  ADD CONSTRAINT gpu_inventory_status_check
  CHECK (status IN ('available', 'in_use', 'reserved', 'maintenance'));

COMMIT;
