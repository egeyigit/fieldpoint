import { api } from './api.js';
import { $, formValues, relativeTime, setOptions, toast } from './ui.js';

const NEW_COLLECTION = '__new__';

export function createCollectionsPanel({ onFocusSite }) {
  const list = $('#collection-list');
  const detail = $('#collection-detail');
  const editForm = $('#collection-edit-form');
  const errorBox = $('#collection-error');
  const pinSelect = $('#site-pin-collection');
  const newName = $('#site-pin-new-name');
  let collections = [];
  let openId = null;
  let currentSiteId = null;

  async function refresh({ preserveDetail = true } = {}) {
    try {
      const result = await api.listCollections();
      collections = result.collections;
      $('#collection-count').textContent = `${collections.length} collection${collections.length === 1 ? '' : 's'}`;
      renderList();
      renderPinOptions();
      if (preserveDetail && openId && collections.some((row) => row.id === openId)) await openCollection(openId);
      if (openId && !collections.some((row) => row.id === openId)) closeDetail();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  function renderList() {
    if (collections.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Create a collection to group and share sites.';
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...collections.map((collection) => {
      const item = document.createElement('li');
      item.className = `site-item${collection.id === openId ? ' selected' : ''}`;
      item.tabIndex = 0;
      const title = document.createElement('div');
      title.className = 'title';
      const name = document.createElement('span');
      name.textContent = collection.name;
      const count = document.createElement('span');
      count.className = `badge${collection.isShared ? ' active' : ''}`;
      count.textContent = `${collection.siteCount} site${collection.siteCount === 1 ? '' : 's'}`;
      title.append(name, count);
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = collection.isShared ? 'Public link on' : 'Private';
      item.append(title, sub);
      item.addEventListener('click', () => openCollection(collection.id));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') openCollection(collection.id);
      });
      return item;
    }));
  }

  async function openCollection(id) {
    try {
      const { collection } = await api.getCollection(id);
      openId = id;
      detail.hidden = false;
      editForm.elements.name.value = collection.name;
      editForm.elements.description.value = collection.description;
      $('#collection-share').checked = Boolean(collection.shareToken);
      setShareUrl(collection.shareToken ? `${location.origin}/shared/${collection.shareToken}` : '');
      renderSites(collection.sites);
      renderList();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  function renderSites(sites) {
    if (sites.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'No sites pinned yet.';
      $('#collection-sites').replaceChildren(empty);
      return;
    }
    $('#collection-sites').replaceChildren(...sites.map((site) => {
      const item = document.createElement('li');
      item.className = 'site-item';
      const title = document.createElement('div');
      title.className = 'title';
      const focus = document.createElement('button');
      focus.type = 'button';
      focus.className = 'link-btn';
      focus.textContent = site.name;
      focus.addEventListener('click', () => onFocusSite(site.id));
      const unpin = document.createElement('button');
      unpin.type = 'button';
      unpin.className = 'ghost small';
      unpin.textContent = 'Unpin';
      unpin.addEventListener('click', () => removeSite(site.id));
      title.append(focus, unpin);
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = `Pinned ${relativeTime(site.pinnedAt)}`;
      item.append(title, sub);
      return item;
    }));
  }

  function renderPinOptions() {
    setOptions(pinSelect, [
      ...collections.map((collection) => [collection.id, collection.name]),
      [NEW_COLLECTION, 'New collection…'],
    ], { placeholder: collections.length ? 'Choose collection' : 'Create a collection…' });
  }

  function setShareUrl(url) {
    $('#collection-share-url').hidden = !url;
    $('#collection-share-input').value = url;
  }

  function closeDetail() {
    openId = null;
    detail.hidden = true;
    renderList();
  }

  async function removeSite(siteId) {
    try {
      await api.unpinSite(openId, siteId);
      toast('Site unpinned');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  async function createNamedCollection(name) {
    const result = await api.createCollection({ name, description: '' });
    await refresh({ preserveDetail: false });
    return result.collection;
  }

  async function openSite(site) {
    currentSiteId = site?.id ?? null;
    newName.hidden = true;
    newName.value = '';
    if (site && collections.length === 0) await refresh({ preserveDetail: false });
    renderPinOptions();
  }

  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!openId) return;
    try {
      await api.updateCollection(openId, formValues(editForm));
      toast('Collection updated');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#collection-new').addEventListener('click', async () => {
    const name = window.prompt('Collection name');
    if (!name?.trim()) return;
    try {
      const collection = await createNamedCollection(name.trim());
      await openCollection(collection.id);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#collection-delete').addEventListener('click', async () => {
    if (!openId || !window.confirm('Delete this collection?')) return;
    try {
      await api.deleteCollection(openId);
      closeDetail();
      toast('Collection deleted');
      await refresh({ preserveDetail: false });
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  $('#collection-share').addEventListener('change', async (event) => {
    if (!openId) return;
    try {
      if (event.target.checked) {
        const shared = await api.shareCollection(openId);
        setShareUrl(shared.shareUrl);
        toast('Public link enabled');
      } else {
        await api.unshareCollection(openId);
        setShareUrl('');
        toast('Public link disabled');
      }
      await refresh({ preserveDetail: false });
      await openCollection(openId);
    } catch (error) {
      event.target.checked = !event.target.checked;
      errorBox.textContent = error.message;
    }
  });

  $('#collection-copy').addEventListener('click', async () => {
    const input = $('#collection-share-input');
    try {
      await navigator.clipboard.writeText(input.value);
      toast('Link copied');
    } catch {
      input.focus();
      input.select();
      toast('Link selected — copy it from the field');
    }
  });

  pinSelect.addEventListener('change', () => {
    newName.hidden = pinSelect.value !== NEW_COLLECTION;
    if (!newName.hidden) newName.focus();
  });

  $('#site-pin-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentSiteId) return;
    try {
      let collectionId = pinSelect.value;
      if (collectionId === NEW_COLLECTION || (!collectionId && collections.length === 0)) {
        const name = newName.value.trim();
        if (!name) {
          newName.hidden = false;
          newName.focus();
          return;
        }
        collectionId = (await createNamedCollection(name)).id;
      }
      if (!collectionId) return;
      await api.pinSite(collectionId, currentSiteId);
      toast('Site pinned');
      newName.value = '';
      await refresh({ preserveDetail: false });
    } catch (error) {
      toast(error.message, true);
    }
  });

  return { refresh, openSite };
}
