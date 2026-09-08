import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import request from 'supertest';
import { SITE, bootApp, createMember, registerAdmin } from './helpers.js';

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function createSite(agent) {
  const created = await agent.post('/api/sites').send(SITE);
  return created.body.site.id;
}

describe('site attachments', () => {
  let ctx;
  beforeEach(async () => {
    ctx = bootApp();
    await registerAdmin(ctx.agent);
  });
  afterEach(() => ctx.close());

  it('uploads, lists, downloads and deletes a file', async () => {
    const siteId = await createSite(ctx.agent);

    const uploaded = await ctx.agent
      .post(`/api/sites/${siteId}/attachments`)
      .attach('file', PNG, { filename: 'damage.png', contentType: 'image/png' });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.attachment.mimeType, 'image/png');
    assert.equal(uploaded.body.attachment.filename, 'damage.png');
    const attachmentId = uploaded.body.attachment.id;

    const listed = await ctx.agent.get(`/api/sites/${siteId}/attachments`);
    assert.equal(listed.body.attachments.length, 1);

    const download = await ctx.agent.get(`/api/sites/${siteId}/attachments/${attachmentId}`);
    assert.equal(download.status, 200);
    assert.match(download.headers['content-disposition'], /attachment; filename="damage.png"/);
    assert.equal(download.headers['content-type'], 'image/png');
    assert.ok(Buffer.from(download.body).equals(PNG));

    const deleted = await ctx.agent.delete(`/api/sites/${siteId}/attachments/${attachmentId}`);
    assert.equal(deleted.status, 204);
    assert.equal((await ctx.agent.get(`/api/sites/${siteId}/attachments`)).body.attachments.length, 0);
  });

  it('rejects a file whose real type is not allowed even when the declared type passes', async () => {
    const siteId = await createSite(ctx.agent);
    const evil = Buffer.from('#!/bin/sh\necho pwned\n');
    const response = await ctx.agent
      .post(`/api/sites/${siteId}/attachments`)
      .attach('file', evil, { filename: 'photo.png', contentType: 'image/png' });
    assert.equal(response.status, 415);
  });

  it('enforces a per-file size cap', async () => {
    const siteId = await createSite(ctx.agent);
    const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    const response = await ctx.agent
      .post(`/api/sites/${siteId}/attachments`)
      .attach('file', big, { filename: 'huge.png', contentType: 'image/png' });
    assert.equal(response.status, 413);
  });

  it('does not let a crafted download id escape the site or the uploads directory', async () => {
    const siteId = await createSite(ctx.agent);
    const other = await ctx.agent.post('/api/sites').send({ ...SITE, name: 'Other' });
    const otherId = other.body.site.id;
    const uploaded = await ctx.agent
      .post(`/api/sites/${otherId}/attachments`)
      .attach('file', PNG, { filename: 'x.png', contentType: 'image/png' });
    const attachmentId = uploaded.body.attachment.id;

    // The attachment belongs to another site, so this site cannot reach it.
    assert.equal((await ctx.agent.get(`/api/sites/${siteId}/attachments/${attachmentId}`)).status, 404);
    // A path-traversal style id never resolves.
    assert.equal((await ctx.agent.get(`/api/sites/${siteId}/attachments/..%2F..%2Fetc%2Fpasswd`)).status, 404);
  });

  it('only admins can delete attachments', async () => {
    const member = await createMember(ctx.agent, ctx.app);
    const siteId = await createSite(member);
    const uploaded = await member
      .post(`/api/sites/${siteId}/attachments`)
      .attach('file', PNG, { filename: 'm.png', contentType: 'image/png' });
    assert.equal(uploaded.status, 201);
    const attachmentId = uploaded.body.attachment.id;
    assert.equal((await member.delete(`/api/sites/${siteId}/attachments/${attachmentId}`)).status, 403);
    assert.equal((await ctx.agent.delete(`/api/sites/${siteId}/attachments/${attachmentId}`)).status, 204);
  });

  it('cleans up files when the site is deleted', async () => {
    const siteId = await createSite(ctx.agent);
    const uploaded = await ctx.agent
      .post(`/api/sites/${siteId}/attachments`)
      .attach('file', PNG, { filename: 'gone.png', contentType: 'image/png' });
    const storagePath = ctx.attachmentPath(uploaded.body.attachment.id);
    assert.ok(existsSync(storagePath));

    await ctx.agent.delete(`/api/sites/${siteId}`);
    assert.equal(existsSync(storagePath), false);
  });
});
