// Starter 404 page. Agents don't edit this file.
import { Button } from "../components/ui.jsx";

export const route = "*";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-5 py-32 text-center">
      <p className="text-sm font-semibold uppercase tracking-wider text-brand">404</p>
      <h1 className="text-4xl font-bold">Page not found</h1>
      <p className="text-muted">The page you're looking for doesn't exist or has moved.</p>
      <Button to="/">Back to home</Button>
    </div>
  );
}
