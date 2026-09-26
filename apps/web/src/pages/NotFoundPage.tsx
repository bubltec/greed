import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <p className="pixel mb-4 text-sm text-hurt">Game over</p>
      <p className="mb-6 text-steel">That page doesn’t exist.</p>
      <Link to="/" className="btn">
        Continue
      </Link>
    </div>
  );
}
