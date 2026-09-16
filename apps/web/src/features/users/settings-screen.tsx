'use client';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { ThemeSwitch } from '@/components/layout/theme-switch';
import { PageHeading, Status } from '@/components/ui/feedback';
export function SettingsScreen() {
  const user = useCurrentUser();
  return (
    <>
      <PageHeading
        eyebrow="MAKE IT YOURS"
        title="Workspace settings"
        description="Your account and the way you see your workspace."
      />
      <div className="stack">
        <section className="panel">
          <div className="panel-heading">
            <h2>Your account</h2>
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
            <div>
              <h2>Appearance</h2>
              <p>Follow your device, or choose your own light or dark theme.</p>
            </div>
            <ThemeSwitch />
          </div>
          <div className="panel-body">
            <p className="muted">
              Your preference is remembered in this browser. Motion follows your
              device’s accessibility settings.
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
