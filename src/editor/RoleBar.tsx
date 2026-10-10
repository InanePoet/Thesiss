import type { RoleReport } from '../lib/analysis';
import type { RoleDef } from '../lib/types';

export function RoleBar({ report, roles, height }: { report: RoleReport; roles: RoleDef[]; height?: number }) {
  const color = (k: string | null) => roles.find((r) => r.key === k)?.color || 'var(--surface-3)';
  if (!report.total) return <div className="rolebar" style={height ? { height } : undefined} />;
  return (
    <div className="rolebar" style={height ? { height } : undefined} title="Ordine e spazio dei ruoli">
      {report.segments.map((s, i) => (
        <i key={i} style={{ flexGrow: s.chars, flexBasis: 0, background: color(s.role), opacity: s.role ? 1 : 0.6 }} />
      ))}
    </div>
  );
}

export function RoleLegend({ report, roles }: { report: RoleReport; roles: RoleDef[] }) {
  const tagged = report.total - report.byRole.none || 1;
  return (
    <div className="legend">
      {roles.map((r) => (
        <span key={r.key}><b style={{ background: r.color }} />{r.label} {report.byRole[r.key] ? Math.round((report.byRole[r.key] / tagged) * 100) + '%' : '–'}</span>
      ))}
      {report.byRole.none > 0 && <span><b style={{ background: 'var(--surface-3)' }} />senza ruolo {Math.round((report.byRole.none / Math.max(1, report.total)) * 100)}%</span>}
    </div>
  );
}
