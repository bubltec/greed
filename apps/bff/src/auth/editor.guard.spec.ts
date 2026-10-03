import { afterEach, describe, expect, it } from 'vitest';
import { editorEmail, editorName, isEditor } from './editor.guard.js';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('editor identity', () => {
  const github = { provider: 'github', providerAccountId: '42', email: 'work@corp.com' };

  it('records the email an account entry signs as, not the provider default', () => {
    process.env.EDITORS = 'github:42=me@example.com';
    expect(isEditor(github)).toBe(true);
    expect(editorEmail(github)).toBe('me@example.com');
  });

  it('falls back to the provider email', () => {
    process.env.EDITORS = 'github:42';
    expect(editorEmail(github)).toBe('work@corp.com');
  });

  it('does not let the signs-as email grant access on its own', () => {
    process.env.EDITORS = 'github:7=me@example.com';
    expect(isEditor({ provider: 'email', providerAccountId: 'me@example.com', email: 'me@example.com' })).toBe(false);
  });
});

describe('editorName', () => {
  it('attributes edits to the email, else the display name', () => {
    expect(editorName({ email: 'a@x.com', displayName: 'A' } as never)).toBe('a@x.com');
    expect(editorName({ displayName: 'A' } as never)).toBe('A');
  });
});
