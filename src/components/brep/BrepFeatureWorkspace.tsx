/* eslint-disable react-refresh/only-export-components -- compatibility facade keeps existing workspace imports stable while hook/context logic lives in a .ts module. */
import { type ReactNode, useMemo, useState } from 'react';
import {
  BrepFeatureWorkspaceContext,
  type BrepWorkspaceView,
} from '@/components/brep/brepFeatureWorkspaceContext';

export {
  BREP_GRAPH_WORKSPACE_TARGET_ID,
  useBrepFeatureWorkspace,
} from '@/components/brep/brepFeatureWorkspaceContext';
export type { BrepWorkspaceView } from '@/components/brep/brepFeatureWorkspaceContext';

export function BrepFeatureWorkspaceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [view, setView] = useState<BrepWorkspaceView>('model');
  const value = useMemo(() => ({ view, setView }), [view]);

  return (
    <BrepFeatureWorkspaceContext.Provider value={value}>
      {children}
    </BrepFeatureWorkspaceContext.Provider>
  );
}
