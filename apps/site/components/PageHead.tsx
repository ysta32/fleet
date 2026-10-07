export function PageHead({ label, title, lead }: { label: string; title: React.ReactNode; lead?: React.ReactNode }) {
  return (
    <header className="wrap page-head">
      <span className="label">{label}</span>
      <h1 className="display" style={{ maxWidth: '16ch' }}>
        {title}
      </h1>
      {lead && <p className="lead">{lead}</p>}
    </header>
  );
}
