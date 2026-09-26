import { SectionTitle } from '../components/bits';
import { RELATION_LABEL, STANCE_LABEL } from '../lib/labels';
import { useTitle } from '../lib/useTitle';

export function AboutPage() {
  useTitle('About');
  return (
    <div className="prose-body max-w-2xl text-snow">
      <h1 className="pixel mb-6 text-sm">About</h1>
      <p className="mb-6 text-steel">
        GREED tracks how money and power move through government: self-dealing, retaliation,
        captured regulators, and the people who make it possible. It started as a single running
        document and outgrew it. Each case is now its own entry, linked to the others it connects to.
      </p>

      <SectionTitle>How an entry is built</SectionTitle>
      <ul className="mb-6 flex list-disc flex-col gap-2 pl-5 text-steel">
        <li>
          <strong className="text-snow">Sources.</strong> Every point is footnoted to a reference. Where a
          source still needs a link, it says so.
        </li>
        <li>
          <strong className="text-snow">Disputed or unproven.</strong> Denials, anonymous sourcing and gaps in
          the record go in a red box at the top, never buried at the bottom.
        </li>
        <li>
          <strong className="text-snow">Perspectives.</strong> The strongest version of each side, attributed:{' '}
          {Object.values(STANCE_LABEL).join(', ').toLowerCase()}.
        </li>
        <li>
          <strong className="text-snow">Connections.</strong> Typed links between entries (
          {Object.values(RELATION_LABEL).join(', ').toLowerCase()}), each marked as sourced, inferred, or added by an
          editor.
        </li>
      </ul>

      <SectionTitle>Open data</SectionTitle>
      <p className="text-steel">
        The whole record is downloadable as JSON from <a href="/api/export">/api/export</a>.
      </p>
    </div>
  );
}
