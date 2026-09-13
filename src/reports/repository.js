import { minutesBetween } from '../work-orders/time-logs.js';

/**
 * Median of a numeric array. For an even count it averages the two middle
 * values; median (not mean) is used so a single runaway timer session does not
 * drag a template's estimate off course.
 */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function createReportRepository(db) {
  // Only completed orders that came from a template tell us anything about a
  // template's estimate. Cancelled orders never happened; orders with no logged
  // time carry no measured actual and would poison the median with a zero.
  const completedWithTemplate = db.prepare(
    `SELECT w.id, w.template_id AS templateId, t.name AS templateName, t.title AS templateTitle,
            t.estimated_minutes AS estimatedMinutes
     FROM work_orders w
     JOIN work_order_templates t ON t.id = w.template_id
     WHERE w.status = 'done'
     ORDER BY t.name COLLATE NOCASE, t.id`,
  );
  const logsFor = db.prepare(
    `SELECT started_at AS startedAt, ended_at AS endedAt
     FROM work_order_time_logs WHERE work_order_id = ?`,
  );

  function actualMinutes(workOrderId) {
    return logsFor
      .all(workOrderId)
      .reduce((sum, row) => sum + (row.endedAt ? minutesBetween(row.startedAt, row.endedAt) : 0), 0);
  }

  return {
    /**
     * One row per template that has at least one completed, time-logged order:
     * its estimate, how many orders informed the number, and the median actual
     * minutes across them.
     */
    estimatesByTemplate() {
      const groups = new Map();
      for (const order of completedWithTemplate.all()) {
        const minutes = actualMinutes(order.id);
        if (minutes <= 0) continue;
        let group = groups.get(order.templateId);
        if (!group) {
          group = {
            templateId: order.templateId,
            templateName: order.templateName,
            templateTitle: order.templateTitle,
            estimatedMinutes: order.estimatedMinutes,
            samples: [],
          };
          groups.set(order.templateId, group);
        }
        group.samples.push(minutes);
      }
      return [...groups.values()].map((group) => ({
        templateId: group.templateId,
        templateName: group.templateName,
        templateTitle: group.templateTitle,
        estimatedMinutes: group.estimatedMinutes,
        count: group.samples.length,
        medianMinutes: median(group.samples),
      }));
    },
  };
}
