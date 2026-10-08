export function PageHead({
  label,
  title,
  lead,
  aside,
}: {
  label: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** fills the right half on wide screens */
  aside?: React.ReactNode;
}) {
  const head = (
    <>
      <span className="label">{label}</span>
      <h1 className="display" style={{ maxWidth: '16ch' }}>
        {title}
      </h1>
      {lead && <p className="lead">{lead}</p>}
    </>
  );
  if (!aside) return <header className="wrap page-head">{head}</header>;
  return (
    <header className="wrap page-head page-head-split">
      <div className="page-head-main">{head}</div>
      <div className="page-head-aside">{aside}</div>
    </header>
  );
}
