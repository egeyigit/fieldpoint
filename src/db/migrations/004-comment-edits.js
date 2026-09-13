/**
 * Comment mutations: mark when a comment was last edited, and when it was
 * soft-deleted. The body itself stays put; the audit log preserves prior
 * versions. Deleted comments are filtered out of the read path.
 */
const SQL = `
ALTER TABLE work_order_comments ADD COLUMN edited_at TEXT;
ALTER TABLE work_order_comments ADD COLUMN deleted_at TEXT;
`;

export const migration004CommentEdits = {
  version: 4,
  name: 'comment-edits',
  up(db) {
    db.exec(SQL);
  },
};
