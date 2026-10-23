// Placeholder home page. A frontend task replaces it.
import { Section } from "../components/ui.jsx";

export const route = "/";

export default function Home() {
  return (
    <Section>
      <h1 className="text-4xl font-bold">Starter app</h1>
      <p className="mt-2 text-muted">The frontend agents replace this page.</p>
    </Section>
  );
}
