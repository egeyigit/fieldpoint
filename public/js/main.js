import { api } from './api.js';
import { createMapView } from './map.js';
import { createSitesPanel } from './sites-panel.js';
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
  const reloadForView = debounce(() => sitesPanel.refresh(), SEARCH_DEBOUNCE_MS);
  const mapView = createMapView($('#map'), {
    onSelect: (id) => sitesPanel.select(id),
    onAddAt: (lat, lng) => sitesPanel.openEditor(null, { lat: lat.toFixed(6), lng: lng.toFixed(6) }),
    onViewChange: () => reloadForView(),
  });
  sitesPanel = createSitesPanel({ mapView, currentUser: user });
  const adminPanel = user.role === 'admin' ? createAdminPanel({ currentUser: user }) : null;

  const refreshSites = debounce(() => sitesPanel.refresh(), SEARCH_DEBOUNCE_MS);
  $('#search').addEventListener('input', refreshSites);
  $('#filter-category').addEventListener('change', () => sitesPanel.refresh());
  $('#filter-status').addEventListener('change', () => sitesPanel.refresh());

  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', async () => {
      document.querySelectorAll('.tab').forEach((element) => element.classList.toggle('active', element === tab));
      $('#panel-sites').hidden = tab.dataset.tab !== 'sites';
      $('#panel-admin').hidden = tab.dataset.tab !== 'admin';
      if (tab.dataset.tab === 'admin' && adminPanel) await adminPanel.refresh();
    });
  }

  $('#logout-btn').addEventListener('click', async () => {
    await api.logout();
    window.location.reload();
  });

  setTimeout(() => mapView.invalidate(), 0);
  await sitesPanel.refresh({ fit: true });
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
