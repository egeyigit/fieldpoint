export const CATEGORIES = {
  office: { label: 'Office', color: '#22c55e' },
  warehouse: { label: 'Warehouse', color: '#f59e0b' },
  client: { label: 'Client', color: '#60a5fa' },
  job_site: { label: 'Job site', color: '#f472b6' },
  vehicle: { label: 'Vehicle', color: '#a78bfa' },
  other: { label: 'Other', color: '#8b98a8' },
};
export const STATUSES = { active: 'Active', planned: 'Planned', inactive: 'Inactive' };
export const SITE_SORTS = { name: 'Name', updated: 'Recently updated', created: 'Recently added' };

export const WORK_ORDER_STATUSES = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  cancelled: 'Cancelled',
};
export const WORK_ORDER_PRIORITIES = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
export const OPEN_WORK_ORDER_STATUSES = ['open', 'in_progress', 'blocked'];
export const WORK_ORDER_SORTS = { due: 'Due date', priority: 'Priority', created: 'Newest', updated: 'Recently updated' };

export const DEFAULT_VIEW = { center: [39.5, -98.35], zoom: 4 };
export const NEAR_ME_RADIUS_KM = 50;
