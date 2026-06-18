import { useOutletContext } from "react-router-dom";
import type { ProjectForm } from "../types/database";

type Ctx = { project: ProjectForm; projectId: string };

export function ComingSoonPage({ title, detail }: { title: string; detail: string }) {
  const { project } = useOutletContext<Ctx>();

  return (
    <section className="card stack coming-soon">
      <h2>{title}</h2>
      <p className="muted">{detail}</p>
      <p>
        This module is on the roadmap for <strong>{project.job_number}</strong>. Desktop JobFlow
        already supports it — we&apos;re porting it to the web app in phases.
      </p>
    </section>
  );
}
