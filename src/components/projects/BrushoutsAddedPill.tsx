type Props = {
  added: boolean;
};

export function BrushoutsAddedPill({ added }: Props) {
  return (
    <span
      className={`project-submittal-pill ${
        added ? "project-submittal-pill--added" : "project-submittal-pill--neutral"
      }`}
    >
      {added ? "Added" : "Not added"}
    </span>
  );
}
