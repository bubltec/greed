import type {
  ContentSnapshot,
  DraftEntry,
  ItemType,
  Status,
  ActivityEntry,
  GraphView,
  PerspectiveInput,
  ReferenceInput,
  Relation,
  RelationInput,
  TopicInput,
  TopicSummary,
  TopicView,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { message?: string | string[] };
      if (data.message) message = Array.isArray(data.message) ? data.message.join('; ') : data.message;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export interface Session {
  user: {
    id: string;
    displayName: string;
    email?: string;
    avatarUrl?: string;
    provider: string;
    providerAccountId: string;
  } | null;
  editor: boolean;
  signIn: { github: boolean; local: boolean };
}

/** `?preview=1` includes drafts; the API honours it only for editors, and skips its cache. */
const q = (preview?: boolean) => (preview ? '?preview=1' : '');

export const api = {
  topics: (preview?: boolean) => request<TopicSummary[]>('GET', `/topics${q(preview)}`),
  topic: (id: string, preview?: boolean) =>
    request<TopicView>('GET', `/topics/${encodeURIComponent(id)}${q(preview)}`),
  graph: (preview?: boolean) => request<GraphView>('GET', `/graph${q(preview)}`),
  activity: (preview?: boolean) => request<ActivityEntry[]>('GET', `/activity${q(preview)}`),
  session: () => request<Session>('GET', '/session'),
  localSignIn: (email?: string) => request<unknown>('POST', '/auth/local', email ? { email } : {}),

  createTopic: (input: TopicInput) => request<TopicView>('POST', '/topics', input),
  updateTopic: (id: string, input: TopicInput) => request<TopicView>('PUT', `/topics/${id}`, input),
  deleteTopic: (id: string) => request<void>('DELETE', `/topics/${id}`),

  addReference: (topicId: string, input: ReferenceInput) =>
    request<TopicView>('POST', `/topics/${topicId}/references`, input),
  updateReference: (topicId: string, refId: string, input: ReferenceInput) =>
    request<TopicView>('PUT', `/topics/${topicId}/references/${refId}`, input),
  deleteReference: (topicId: string, refId: string) =>
    request<TopicView>('DELETE', `/topics/${topicId}/references/${refId}`),

  addPerspective: (topicId: string, input: PerspectiveInput) =>
    request<TopicView>('POST', `/topics/${topicId}/perspectives`, input),
  updatePerspective: (topicId: string, pid: string, input: PerspectiveInput) =>
    request<TopicView>('PUT', `/topics/${topicId}/perspectives/${pid}`, input),
  deletePerspective: (topicId: string, pid: string) =>
    request<TopicView>('DELETE', `/topics/${topicId}/perspectives/${pid}`),

  addRelation: (input: RelationInput) => request<Relation>('POST', '/relations', input),
  updateRelation: (id: string, input: RelationInput) => request<Relation>('PUT', `/relations/${id}`, input),
  deleteRelation: (id: string) => request<void>('DELETE', `/relations/${id}`),
  exportAll: () => request<ContentSnapshot>('GET', '/export?preview=1'),

  drafts: () => request<DraftEntry[]>('GET', '/drafts'),
  setStatus: (status: Status, items: { type: ItemType; id: string }[]) =>
    request<{ updated: number }>('POST', '/status', { status, items }),
  publishTopic: (id: string, includeChildren = true) =>
    request<TopicView>('POST', `/topics/${id}/publish`, { includeChildren }),
};
