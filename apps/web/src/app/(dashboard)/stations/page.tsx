'use client';
import { StationsScreen } from '@/features/production/station-screen';
import { ManualCutEditorContext } from '@/features/production/recut-actions';
import { ManualCutEditor } from '@/features/allocations';
export default function Page() {
  return (
    <ManualCutEditorContext.Provider
      value={(props) => <ManualCutEditor {...props} />}
    >
      <StationsScreen />
    </ManualCutEditorContext.Provider>
  );
}
