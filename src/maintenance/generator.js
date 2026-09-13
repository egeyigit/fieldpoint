import { advanceDueDate, todayIso } from './repository.js';

/**
 * Turns every due schedule into a work order, then moves its due date forward.
 *
 * Runs on a timer and from an admin endpoint, so it must be safe to call twice:
 * a schedule is only picked up when `next_due_date <= today`, and advancing that
 * date is part of the same transaction as creating the order. Two concurrent
 * sweeps therefore cannot both generate for the same day.
 */
export function generateDueWorkOrders(db, { schedules, workOrders, checklist, templates, today = todayIso(), actorId = null } = {}) {
  const due = schedules.list({ dueOnly: true, today });
  const created = [];

  for (const schedule of due) {
    db.exec('BEGIN IMMEDIATE');
    try {
      // Re-read inside the transaction: another sweep may have just moved it.
      const current = schedules.findById(schedule.id);
      if (!current || !current.isActive || current.nextDueDate > today) {
        db.exec('ROLLBACK');
        continue;
      }
      const order = workOrders.create(
        {
          siteId: current.siteId,
          title: current.title,
          description: current.description,
          status: 'open',
          priority: current.priority,
          assignedTo: current.assignedTo,
          dueDate: current.nextDueDate,
          templateId: current.templateId,
          scheduleId: current.id,
        },
        actorId ?? null,
      );
      if (current.templateId) {
        const items = templates.itemsFor(current.templateId).map((item) => item.text);
        if (items.length > 0) checklist.addMany(order.id, items);
      }
      schedules.markGenerated(current.id, advanceDueDate(current.nextDueDate, current.intervalDays, today));
      db.exec('COMMIT');
      created.push({ scheduleId: current.id, workOrderId: order.id, title: order.title });
    } catch (error) {
      db.exec('ROLLBACK');
      // One bad schedule must not stop the sweep for every other site.
      console.error(`[maintenance] schedule ${schedule.id} failed to generate`, error);
    }
  }
  return created;
}
