# FieldPoint data model

This document describes every table FieldPoint creates, the foreign-key
behaviour chosen for each relationship, and the deliberate — sometimes
non-obvious — reasons behind three referential decisions. It also states what
the data model explicitly does *not* guarantee.

The schema is defined by the numbered, transactional migrations in
`src/db/migrations/`. An older database upgrades on boot; a newer one is
refused. The tables below are grouped by the migration that introduced them.

## Tables

### Migration 001 — baseline

| Table | Purpose | Key foreign keys |
| --- | --- | --- |
| `users` | Accounts: email, name, scrypt password hash, `role` (`admin` / `member`), `is_active`. | — |
| `sessions` | Server-side sessions keyed by opaque id. | `user_id → users(id) ON DELETE CASCADE` — a deleted user's sessions vanish with them. |
| `sites` | The map's core entity: name, address, `lat`/`lng`, `category`, `status`, notes. | `created_by`, `updated_by → users(id) ON DELETE SET NULL` — history survives a user deletion; only the attribution is cleared. |
| `audit_log` | Append-only trail of logins, user changes and site mutations. | `user_id → users(id) ON DELETE SET NULL` — the entry outlives the actor. |

### Migration 002 — site ownership and soft delete

Adds columns to `sites`:

| Column | Purpose | Foreign key |
| --- | --- | --- |
| `assigned_to` | The user responsible for a site. | `→ users(id) ON DELETE SET NULL` |
| `deleted_at` | Soft-delete marker; `NULL` means visible. | — |
| `deleted_by` | Who soft-deleted the site. | `→ users(id) ON DELETE SET NULL` |

### Migration 003 — work orders

| Table | Purpose | Key foreign keys |
| --- | --- | --- |
| `work_orders` | The unit of field work: title, description, `status`, `priority`, assignee, due date, derived `completed_at`. | `site_id → sites(id) ON DELETE CASCADE`; `assigned_to`, `created_by`, `updated_by → users(id) ON DELETE SET NULL`. |
| `work_order_comments` | The crew's thread on an order. | `work_order_id → work_orders(id) ON DELETE CASCADE`; `author_id → users(id) ON DELETE SET NULL`. |

### Migration 004 — planned maintenance

| Table | Purpose | Key foreign keys |
| --- | --- | --- |
| `work_order_templates` | Reusable recipe: name, title, priority, estimate, archive flag. | `created_by`, `updated_by → users(id) ON DELETE SET NULL`. |
| `work_order_template_items` | Ordered checklist lines belonging to a template. | `template_id → work_order_templates(id) ON DELETE CASCADE` — a template's lines are part of the template. |
| `work_order_checklist_items` | A work order's *own* checklist, with per-item `is_done` / `done_by` / `done_at`. | `work_order_id → work_orders(id) ON DELETE CASCADE`; `done_by → users(id) ON DELETE SET NULL`. |
| `work_order_time_logs` | Clock-in / clock-out (or manual) entries against an order. | `work_order_id → work_orders(id) ON DELETE CASCADE`; `user_id → users(id) ON DELETE SET NULL`. A partial unique index (`WHERE ended_at IS NULL`) allows only one running timer per user. |
| `maintenance_schedules` | Recurring generator: cadence (`interval_days`), `next_due_date`, `last_generated_at`, active flag. | `site_id → sites(id) ON DELETE CASCADE`; `template_id → work_order_templates(id) ON DELETE SET NULL`; `assigned_to`, `created_by`, `updated_by → users(id) ON DELETE SET NULL`. |

Migration 004 also adds three columns to `work_orders`:

| Column | Purpose | Foreign key |
| --- | --- | --- |
| `template_id` | The template a work order was instantiated from, if any. | `→ work_order_templates(id) ON DELETE SET NULL` |
| `schedule_id` | The schedule that generated the order, if any. | `→ maintenance_schedules(id) ON DELETE SET NULL` |
| `estimated_minutes` | Estimate copied from the template at creation. | — |

## Three deliberate referential choices

### 1. Checklist items are copied, not referenced

A work order does not point at its template's checklist. When an order is
created from a template, each `work_order_template_items` row is copied into a
fresh `work_order_checklist_items` row (see `checklist.js`'s `addMany`, and
`templates/repository.js`, which rewrites template items wholesale on every
update).

**Reason:** editing a template later must never rewrite the record of what a
technician already ticked off. The tick, its author and its timestamp live on
the order's own copy, so a template change cannot rewrite completed history.

### 2. Deleting a template nulls references — it does not cascade

Both `work_orders.template_id` and `maintenance_schedules.template_id` use
`ON DELETE SET NULL`, not `ON DELETE CASCADE`.

**Reason:** a template is an origin, not an owner. Work orders and schedules are
real operational records that must outlive the recipe they came from. Cascading
would destroy live work; nulling severs only the backward link to the deleted
template.

### 3. Soft delete exists only on sites

Only `sites` carries `deleted_at` / `deleted_by`. Every read path excludes
soft-deleted rows (`s.deleted_at IS NULL`), admins can view a recycle bin with
`includeDeleted`, and `restore` clears the marker. No other table has this.

**Reason:** an accidental site deletion is expensive and destroys the map anchor
for its work orders, so it is recoverable. Other entities are deleted for real;
their cascade or set-null behaviour above defines what goes with them.

## Answering the operational question: deleting a template

> *What happens to open work orders when I delete a template?*

Nothing happens to the work orders themselves. Because
`work_orders.template_id` is `ON DELETE SET NULL`, deleting the template only
sets that column to `NULL` on any orders it produced; their status, checklist,
comments and time logs are untouched. The same applies to any
`maintenance_schedules` built from the template — their `template_id` becomes
`NULL` and they keep generating work from their stored title, priority and
description. The template's own checklist rows
(`work_order_template_items`) are cascade-deleted with it, but those were never
shared with the orders — each order holds its own copied checklist.

## What the data model does NOT guarantee

- **Single writer.** The design assumes one SQLite process. There is no
  optimistic locking or version column; concurrent writers to the same row can
  clobber each other. Move to Postgres behind the repository layer for
  multi-instance deployments.
- **No tenancy.** There is no organisation or tenant column anywhere. Every
  user sees every site, work order, template and schedule. The model is a
  single shared workspace, not a multi-tenant one.
- **No read auditing.** `audit_log` records logins, user changes and site
  mutations — writes and authentication events. Reads (listing or viewing
  sites, work orders, templates, time logs) are never audited.
