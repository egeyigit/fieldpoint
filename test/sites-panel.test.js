import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

// The panel imports browser-only ES modules; we replace them with stubs through
// the module mocker so the *shipped* createSitesPanel runs against a minimal
// DOM. This exercises the real renderStats/refresh wiring — the stats strip
// renders during refresh and a status chip click toggles the filter and
// re-runs both the list query and the stats query.

function makeElement(id) {
  const listeners = {};
  return {
    id,
    value: '',
    checked: false,
    hidden: false,
    href: '',
    textContent: '',
    title: '',
    className: '',
    dataset: {},
    tabIndex: 0,
    classList: { add() {}, remove() {}, toggle() {} },
    children: [],
    elements: {},
    style: {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children = nodes;
    },
    setAttribute() {},
    reset() {},
    showModal() {},
    close() {},
    addEventListener(type, handler) {
      (listeners[type] ??= []).push(handler);
    },
    dispatch(type, event = {}) {
      for (const handler of listeners[type] ?? []) handler(event);
    },
  };
}

function installDom() {
  const registry = new Map();
  const get = (selector) => {
    const id = selector.replace(/^#/, '');
    if (!registry.has(id)) registry.set(id, makeElement(id));
    return registry.get(id);
  };
  globalThis.document = {
    createElement: () => makeElement(''),
    querySelectorAll: () => [],
  };
  return { get, registry };
}

describe('sites panel stats strip', () => {
  afterEach(() => {
    delete globalThis.document;
    mock.reset();
  });

  it('renders a total plus per-status chips and filters on chip click', async () => {
    const { get, registry } = installDom();

    let listCalls = 0;
    let statsCalls = 0;
    const api = {
      listSites: async () => {
        listCalls += 1;
        return { sites: [], total: 0 };
      },
      siteStats: async () => {
        statsCalls += 1;
        return {
          stats: [
            { status: 'active', count: 3 },
            { status: 'planned', count: 2 },
          ],
        };
      },
      directory: async () => ({ users: [] }),
    };

    // Stub the browser-only modules the panel imports, then load the real panel.
    mock.module('../public/js/api.js', {
      namedExports: { api, geocode: async () => ({}), locateBrowser: async () => ({}) },
    });
    mock.module('../public/js/constants.js', {
      namedExports: {
        CATEGORIES: { client: { label: 'Client' } },
        NEAR_ME_RADIUS_KM: 50,
        SITE_SORTS: { name: 'Name' },
        STATUSES: { active: 'Active', planned: 'Planned', inactive: 'Inactive' },
      },
    });
    mock.module('../public/js/ui.js', {
      namedExports: {
        $: get,
        absoluteTime: () => '',
        formValues: () => ({}),
        relativeTime: () => '',
        setOptions: () => {},
        toast: () => {},
      },
    });

    const { createSitesPanel } = await import('../public/js/sites-panel.js');
    const mapView = { render() {}, fitAll() {}, focus() {} };
    const panel = createSitesPanel({ mapView, currentUser: { id: 1, role: 'admin' } });

    await panel.refresh();

    const strip = registry.get('site-stats');
    assert.equal(strip.children[0].textContent, 'Total 5');
    const labels = strip.children.slice(1).map((chip) => chip.textContent);
    assert.deepEqual(labels, ['Active 3', 'Planned 2', 'Inactive 0']);

    const listBefore = listCalls;
    const statsBefore = statsCalls;
    strip.children[1].dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(registry.get('filter-status').value, 'active');
    assert.ok(listCalls > listBefore, 'clicking a status chip re-runs the list query');
    assert.ok(statsCalls > statsBefore, 'stats refresh in sync with the list mutation');
  });
});
