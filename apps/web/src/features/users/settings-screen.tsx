'use client';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { ThemeSwitch } from '@/components/layout/theme-switch';
import { PageHeading, Status } from '@/components/ui/feedback';
export function SettingsScreen() {
  const user = useCurrentUser();
  return (
    <>
      <PageHeading title="Settings" />
      <div className="stack">
        <section className="panel">
          <div className="panel-heading">
            <h2>Account</h2>
            <Status value={user.role} />
          </div>
          <div className="panel-body details-grid">
            <div>
              <div className="detail-label">Name</div>
              <div className="detail-value">{user.name}</div>
            </div>
            <div>
              <div className="detail-label">Work email</div>
              <div className="detail-value">{user.email}</div>
            </div>
            <div>
              <div className="detail-label">Sign-in method</div>
              <div className="detail-value">Microsoft work account</div>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Appearance</h2>
            <ThemeSwitch />
          </div>
          <div className="panel-body">
            <p className="muted">
              Saved in this browser. Reduced motion follows your device
              settings.
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Measurements</h2>
          </div>
          <div className="panel-body details-grid">
            <div>
              <div className="detail-label">Fabric widths</div>
              <div className="detail-value">Inches</div>
            </div>
            <div>
              <div className="detail-label">Fabric lengths</div>
              <div className="detail-value">Yards</div>
            </div>
            <div>
              <div className="detail-label">Thickness, tube, and depth</div>
              <div className="detail-value">Millimetres</div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
