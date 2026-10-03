import { statusOf, type TopicView } from '@greed/domain';

/** Trimmed view for MCP write results: enough to chain calls, without re-sending everything. */
export function compactTopicView(view: TopicView) {
  return {
    id: view.topic.id,
    title: view.topic.title,
    status: statusOf(view.topic),
    url: `/t/${view.topic.id}`,
    sections: view.topic.sections.map((s) => ({ label: s.label, points: s.points.length })),
    references: view.references.map((r) => ({ id: r.id, label: r.label, url: r.url, status: statusOf(r) })),
    perspectives: view.perspectives.map((p) => ({ id: p.id, stance: p.stance, holder: p.holder, status: statusOf(p) })),
    related: view.related.map((r) => ({
      relationId: r.relation.id,
      kind: r.relation.kind,
      topicId: r.other.id,
      status: statusOf(r.relation),
    })),
  };
}
