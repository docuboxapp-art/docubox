import type { ReactNode } from 'react';

export default function OrganizationPageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="organization-page-heading">
      <div className="min-w-0">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
