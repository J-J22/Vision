"use client";
// /p/<id> sends you to the stage the project is at
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProjectHome({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((p) => {
        if (p.error) return router.replace("/");
        if (p.stage === "build" && p.buildId) router.replace(`/build/${p.buildId}?project=${id}`);
        else router.replace(`/p/${id}/${p.stage}`);
      });
  }, [id, router]);
  return <main className="content muted">Opening project…</main>;
}
