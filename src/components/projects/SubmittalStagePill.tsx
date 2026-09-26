type Props = {
  stage: string;
};

function stageClass(stage: string): string {
  if (stage === "Approved") return "project-submittal-pill project-submittal-pill--approved";
  if (stage === "Match Existing") return "project-submittal-pill project-submittal-pill--match";
  if (stage === "Not Needed") return "project-submittal-pill project-submittal-pill--not-needed";
  if (stage === "Not started") return "project-submittal-pill project-submittal-pill--not-started";
  return "project-submittal-pill project-submittal-pill--active";
}

export function SubmittalStagePill({ stage }: Props) {
  return <span className={stageClass(stage)}>{stage}</span>;
}
