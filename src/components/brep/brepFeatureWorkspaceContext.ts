import { createContext, useContext } from 'react';

export const BREP_GRAPH_WORKSPACE_TARGET_ID = 'brep-graph-workspace-target';

export type BrepWorkspaceView = 'model' | 'graph';

export type BrepFeatureWorkspaceContextValue = {
  view: BrepWorkspaceView;
  setView: (view: BrepWorkspaceView) => void;
};

export const BrepFeatureWorkspaceContext =
  createContext<BrepFeatureWorkspaceContextValue | null>(null);

export function useBrepFeatureWorkspace(): BrepFeatureWorkspaceContextValue {
  const value = useContext(BrepFeatureWorkspaceContext);
  if (!value) {
    throw new Error(
      'BRep feature workspace controls require BrepFeatureWorkspaceProvider.',
    );
  }
  return value;
}
