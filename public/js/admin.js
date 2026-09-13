import { api } from './api.js';
import { $, formValues, toast } from './ui.js';

export function createAdminPanel({ currentUser }) {
  const tbody = $('#user-table tbody');
  const auditList = $('#audit-list');
  const errorBox = $('#admin-error');

  function renderUsers(users) {
    tbody.replaceChildren();
    for (const user of users) {
      const row = document.createElement('tr');
      const who = document.createElement('td');
      const name = document.createElement('div');
      name.textContent = user.name;
      const email = document.createElement('div');
      email.className = 'mono muted';
      email.textContent = user.email;
      who.append(name, email);

      const roleCell = document.createElement('td');
      const roleSelect = document.createElement('select');
      for (const role of ['member', 'admin']) {
        const option = document.createElement('option');
        option.value = role;
        option.textContent = role;
        option.selected = user.role === role;
        roleSelect.append(option);
      }
      roleSelect.disabled = user.id === currentUser.id;
      roleSelect.addEventListener('change', () => update(user.id, { role: roleSelect.value }));
      roleCell.append(roleSelect);

      const activeCell = document.createElement('td');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = Boolean(user.isActive);
      toggle.disabled = user.id === currentUser.id;
      toggle.style.width = 'auto';
      toggle.addEventListener('change', () => update(user.id, { isActive: toggle.checked }));
      activeCell.append(toggle);

      const actionsCell = document.createElement('td');
      const resetButton = document.createElement('button');
      resetButton.type = 'button';
      resetButton.textContent = 'Reset password';
      resetButton.addEventListener('click', () => resetPassword(user));
      actionsCell.append(resetButton);

      row.append(who, roleCell, activeCell, actionsCell);
      tbody.append(row);
    }
  }

  function renderAudit(entries) {
    auditList.replaceChildren();
    for (const entry of entries) {
      const item = document.createElement('li');
      const when = new Date(entry.createdAt).toLocaleString();
      const who = entry.userEmail ?? 'system';
      const strong = document.createElement('b');
      strong.textContent = entry.action;
      item.append(strong, ` · ${who} · ${entry.entityType}${entry.entityId ? ` #${entry.entityId}` : ''} · ${when}`);
      auditList.append(item);
    }
  }

  async function update(id, patch) {
    errorBox.textContent = '';
    try {
      await api.updateUser(id, patch);
      toast('User updated');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
      await refresh();
    }
  }

  async function resetPassword(user) {
    errorBox.textContent = '';
    const newPassword = window.prompt(`New password for ${user.email}`);
    if (newPassword === null) return;
    try {
      await api.resetUserPassword(user.id, newPassword);
      toast('Password reset');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  async function refresh() {
    try {
      const [usersResult, auditResult] = await Promise.all([api.listUsers(), api.audit()]);
      renderUsers(usersResult.users);
      renderAudit(auditResult.entries);
    } catch (error) {
      errorBox.textContent = error.message;
    }
  }

  $('#invite-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.textContent = '';
    try {
      await api.register(formValues(event.target));
      event.target.reset();
      toast('User created');
      await refresh();
    } catch (error) {
      errorBox.textContent = error.message;
    }
  });

  return { refresh };
}
