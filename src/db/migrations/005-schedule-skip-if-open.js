/**
 * Recurring schedules should not pile up duplicate open orders. A schedule
 * that has fallen behind on a job whose last generated order is still open now
 * advances its due date instead of generating another identical order. This
 * behaviour is opt-out per schedule via `skip_if_open`, defaulting on.
 */
const SQL = `
ALTER TABLE maintenance_schedules ADD COLUMN skip_if_open INTEGER NOT NULL DEFAULT 1;
`;

export const migration005ScheduleSkipIfOpen = {
  version: 5,
  name: 'schedule-skip-if-open',
  up(db) {
    db.exec(SQL);
  },
};
