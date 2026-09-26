import type {
  ContentSnapshot,
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

const q = (fresh?: boolean) => (fresh ? '?fresh=1' : '');

export const api = {
  topics: (fresh?: boolean) => request<TopicSummary[]>('GET', `/topics${q(fresh)}`),
  topic: (id: string, fresh?: boolean) =>
    request<TopicView>('GET', `/topics/${encodeURIComponent(id)}${q(fresh)}`),
  graph: () => request<GraphView>('GET', '/graph'),
  activity: () => request<ActivityEntry[]>('GET', '/activity'),
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
  exportAll: () => request<ContentSnapshot>('GET', '/export'),
};
