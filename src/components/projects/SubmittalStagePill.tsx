type Props = {
  stage: string;
};

function stageClass(stage: string): string {
  if (stage === "Approved") return "project-submittal-pill project-submittal-pill--approved";
  if (stage === "Not started") return "project-submittal-pill project-submittal-pill--neutral";
  return "project-submittal-pill project-submittal-pill--active";
}

export function SubmittalStagePill({ stage }: Props) {
  return <span className={stageClass(stage)}>{stage}</span>;
}
