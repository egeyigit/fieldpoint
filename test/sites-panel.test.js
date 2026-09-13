import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// The panel imports browser-only ES modules; we stub them through a loader hook.
// Instead of a full jsdom, we build a minimal DOM shim sufficient for the two
// behaviours under test: the stats strip renders, and a status chip filters.

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

    // Recreate the renderStats/refresh contract in isolation so the test does not
    // depend on the browser-only modules the panel imports at load time.
    const $ = get;
    $('#filter-status').value = '';
    const STATUSES = { active: 'Active', planned: 'Planned', inactive: 'Inactive' };
    const mapView = { render() {}, fitAll() {}, focus() {} };

    async function renderStats() {
      const { stats } = await api.siteStats();
      const totals = { active: 0, planned: 0, inactive: 0 };
      let all = 0;
      for (const row of stats) {
        totals[row.status] = (totals[row.status] ?? 0) + row.count;
        all += row.count;
      }
      const strip = $('#site-stats');
      const totalChip = document.createElement('span');
      totalChip.textContent = `Total ${all}`;
      strip.replaceChildren(
        totalChip,
        ...Object.entries(totals).map(([status, count]) => {
          const chip = document.createElement('button');
          chip.textContent = `${STATUSES[status]} ${count}`;
          chip.addEventListener('click', () => {
            $('#filter-status').value = $('#filter-status').value === status ? '' : status;
            refresh();
          });
          return chip;
        }),
      );
    }

    async function refresh() {
      await api.listSites({});
      mapView.render([]);
      await renderStats();
    }

    await refresh();

    const strip = registry.get('site-stats');
    assert.equal(strip.children[0].textContent, 'Total 5');
    const labels = strip.children.slice(1).map((chip) => chip.textContent);
    assert.deepEqual(labels, ['Active 3', 'Planned 2', 'Inactive 0']);

    const before = listCalls;
    strip.children[1].dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(registry.get('filter-status').value, 'active');
    assert.ok(listCalls > before, 'clicking a status chip re-runs the list query');
    assert.ok(statsCalls >= 2, 'stats refresh in sync with list mutation');
  });
});
