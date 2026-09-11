/**
 * Soft delete for work orders: a mis-click on an order should be reversible
 * just like it is for sites. Deleting an order now stamps `deleted_at` and
 * `deleted_by` instead of destroying the row, so the ON DELETE CASCADE that
 * links comments never fires and the thread survives to be restored.
 */
const SQL = `
ALTER TABLE work_orders ADD COLUMN deleted_at TEXT;
ALTER TABLE work_orders ADD COLUMN deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_deleted ON work_orders(deleted_at);
`;

export const migration004WorkOrderSoftDelete = {
  version: 4,
  name: 'work-order-soft-delete',
  up(db) {
    db.exec(SQL);
  },
};
