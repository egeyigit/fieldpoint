import { api } from './api.js';
import { createMapView } from './map.js';
import { createSitesPanel } from './sites-panel.js';
import { createWorkOrdersPanel } from './work-orders-panel.js';
import { createMaintenancePanel } from './maintenance-panel.js';
import { createAdminPanel } from './admin.js';
import { $, debounce, formValues, toast } from './ui.js';

const SEARCH_DEBOUNCE_MS = 250;

function showAuth({ needsBootstrap }) {
  $('#app-view').hidden = true;
  $('#auth-view').hidden = false;
  $('#name-field').hidden = !needsBootstrap;
  $('#auth-subtitle').textContent = needsBootstrap
    ? 'No accounts yet — create the first administrator'
    : 'Sign in to your workspace';
  $('#auth-submit').textContent = needsBootstrap ? 'Create admin account' : 'Sign in';
  $('#auth-form').dataset.mode = needsBootstrap ? 'register' : 'login';
}

async function showApp(user) {
  $('#auth-view').hidden = true;
  $('#app-view').hidden = false;
  $('#user-label').textContent = `${user.email} · ${user.role}`;
  $('#admin-tab').hidden = user.role !== 'admin';

  let sitesPanel = null;
  const mapView = createMapView($('#map'), {
    onSelect: (id) => sitesPanel.select(id),
    onAddAt: (lat, lng) => sitesPanel.openEditor(null, { lat: lat.toFixed(6), lng: lng.toFixed(6) }),
  });
  sitesPanel = createSitesPanel({ mapView, currentUser: user });
  const maintenancePanel = createMaintenancePanel({
    currentUser: user,
    getSites: () => sitesPanel.getSites(),
  });
  const workOrdersPanel = createWorkOrdersPanel({
    currentUser: user,
    getSites: () => sitesPanel.getSites(),
    getTemplates: () => maintenancePanel.getTemplates(),
    onFocusSite: (siteId) => {
      showTab('sites');
      sitesPanel.select(siteId);
    },
  });
  const adminPanel = user.role === 'admin' ? createAdminPanel({ currentUser: user }) : null;

  // A persistent indicator so a running timer is never invisible. It refreshes
  // whenever the work-orders panel changes a timer, and on a slow interval to
  // catch a timer left running in another session.
  const runningTimerBtn = $('#running-timer');
  let runningWorkOrderId = null;
  async function refreshRunningTimer() {
    try {
      const { workOrders } = await api.listWorkOrders({ assignedTo: user.id, limit: 500 });
      let running = null;
      for (const order of workOrders) {
        const detail = await api.getWorkOrder(order.id);
        const open = detail.timeLogs.find((log) => log.endedAt === null && log.userId === user.id);
        if (open) {
          running = { order, open };
          break;
        }
      }
      runningWorkOrderId = running ? running.order.id : null;
      runningTimerBtn.hidden = !running;
      if (running) runningTimerBtn.textContent = `\u23F1 ${running.order.title}`;
    } catch {
      runningTimerBtn.hidden = true;
    }
  }
  runningTimerBtn.addEventListener('click', async () => {
    if (!runningWorkOrderId) return;
    showTab('work-orders');
    await workOrdersPanel.refresh();
    const { workOrder } = await api.getWorkOrder(runningWorkOrderId);
    workOrdersPanel.openEditor(workOrder);
  });

  function showTab(name) {
    for (const tab of document.querySelectorAll('.tab')) {
      tab.classList.toggle('active', tab.dataset.tab === name);
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    }
    $('#panel-sites').hidden = name !== 'sites';
    $('#panel-work-orders').hidden = name !== 'work-orders';
    $('#panel-maintenance').hidden = name !== 'maintenance';
    $('#panel-admin').hidden = name !== 'admin';
  }

  const refreshSites = debounce(() => sitesPanel.refresh(), SEARCH_DEBOUNCE_MS);
  $('#search').addEventListener('input', refreshSites);
  $('#filter-category').addEventListener('change', () => sitesPanel.refresh());
  $('#filter-status').addEventListener('change', () => sitesPanel.refresh());

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', async () => {
      showTab(tab.dataset.tab);
      if (tab.dataset.tab === 'work-orders') await workOrdersPanel.refresh();
      if (tab.dataset.tab === 'maintenance') await maintenancePanel.refresh();
      if (tab.dataset.tab === 'admin' && adminPanel) await adminPanel.refresh();
    });
  }

  $('#logout-btn').addEventListener('click', async () => {
    await api.logout();
    window.location.reload();
  });

  setTimeout(() => mapView.invalidate(), 0);
  await sitesPanel.refresh({ fit: true });
  // Templates feed the work-order dialog's picker, so load them up front.
  await maintenancePanel.refresh();
  await refreshRunningTimer();
  workOrdersPanel.onTimerChange = refreshRunningTimer;
  setInterval(refreshRunningTimer, 60000);
}

async function boot() {
  const authForm = $('#auth-form');
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = $('#auth-error');
    errorBox.textContent = '';
    const values = formValues(authForm);
    try {
      if (authForm.dataset.mode === 'register') {
        await api.register(values);
      } else {
        await api.login({ email: values.email, password: values.password });
      }
      window.location.reload();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  try {
    const { user, needsBootstrap } = await api.me();
    if (user) await showApp(user);
    else showAuth({ needsBootstrap });
  } catch (error) {
    showAuth({ needsBootstrap: false });
    toast(error.message, true);
  }
}

boot();
