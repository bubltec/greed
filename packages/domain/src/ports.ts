import type { ContentSnapshot, Perspective, Reference, Relation, Topic } from './entities.js';

/**
 * Persistence port. The BFF depends on this, never on DynamoDB directly, so
 * the in-memory fake below can stand in for tests.
 */
export interface ContentStore {
  loadAll(): Promise<ContentSnapshot>;
  putTopic(topic: Topic): Promise<void>;
  /** Deletes the topic and everything that hangs off it (refs, perspectives, relations). */
  deleteTopic(topicId: string): Promise<void>;
  putReference(reference: Reference): Promise<void>;
  deleteReference(topicId: string, referenceId: string): Promise<void>;
  putPerspective(perspective: Perspective): Promise<void>;
  deletePerspective(topicId: string, perspectiveId: string): Promise<void>;
  putRelation(relation: Relation): Promise<void>;
  deleteRelation(relationId: string): Promise<void>;
}

export class InMemoryContentStore implements ContentStore {
  private topics = new Map<string, Topic>();
  private references = new Map<string, Reference>();
  private perspectives = new Map<string, Perspective>();
  private relations = new Map<string, Relation>();

  constructor(seed?: Partial<ContentSnapshot>) {
    for (const t of seed?.topics ?? []) this.topics.set(t.id, t);
    for (const r of seed?.references ?? []) this.references.set(r.id, r);
    for (const p of seed?.perspectives ?? []) this.perspectives.set(p.id, p);
    for (const r of seed?.relations ?? []) this.relations.set(r.id, r);
  }

  async loadAll(): Promise<ContentSnapshot> {
    return structuredClone({
      topics: [...this.topics.values()],
      references: [...this.references.values()],
      perspectives: [...this.perspectives.values()],
      relations: [...this.relations.values()],
    });
  }

  async putTopic(topic: Topic) {
    this.topics.set(topic.id, structuredClone(topic));
  }

  async deleteTopic(topicId: string) {
    this.topics.delete(topicId);
    for (const [id, r] of this.references) if (r.topicId === topicId) this.references.delete(id);
    for (const [id, p] of this.perspectives) if (p.topicId === topicId) this.perspectives.delete(id);
    for (const [id, r] of this.relations) {
      if (r.fromId === topicId || r.toId === topicId) this.relations.delete(id);
    }
  }

  async putReference(reference: Reference) {
    this.references.set(reference.id, structuredClone(reference));
  }

  async deleteReference(_topicId: string, referenceId: string) {
    this.references.delete(referenceId);
  }

  async putPerspective(perspective: Perspective) {
    this.perspectives.set(perspective.id, structuredClone(perspective));
  }

  async deletePerspective(_topicId: string, perspectiveId: string) {
    this.perspectives.delete(perspectiveId);
  }

  async putRelation(relation: Relation) {
    this.relations.set(relation.id, structuredClone(relation));
  }

  async deleteRelation(relationId: string) {
    this.relations.delete(relationId);
  }
}
