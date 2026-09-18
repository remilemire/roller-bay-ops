'use client';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { ThemeSwitch } from '@/components/layout/theme-switch';
import { PageHeading, Status } from '@/components/ui/feedback';
import { ColorThemePicker } from './color-theme-picker';
import { MeasurementUnitsPanel } from './measurement-units-panel';
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
        <section className="panel" aria-labelledby="appearance-heading">
          <div className="panel-heading">
            <h2 id="appearance-heading">Appearance</h2>
            <ThemeSwitch />
          </div>
          <div className="panel-body">
            <ColorThemePicker />
            <p className="muted">
              Color theme is saved to your account; light or dark mode is saved
              in this browser. Reduced motion follows your device settings.
            </p>
          </div>
        </section>
        <MeasurementUnitsPanel />
      </div>
    </>
  );
}
