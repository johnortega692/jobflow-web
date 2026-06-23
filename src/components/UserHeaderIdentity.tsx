import type { UserProfile } from "../types/userProfile";

type Props = {
  profile: UserProfile;
  email?: string | null;
  className?: string;
};

export function UserHeaderIdentity({ profile, email, className }: Props) {
  const name = profile.name.trim() || email?.trim() || "";
  const title = profile.title.trim();

  if (!name && !title) return null;

  return (
    <div
      className={`user-header-identity${className ? ` ${className}` : ""}`}
      title={email ?? undefined}
    >
      {name ? <span className="user-header-identity-line">{name}</span> : null}
      {title ? <span className="user-header-identity-line user-header-identity-line--muted">{title}</span> : null}
    </div>
  );
}
