import { BrepFeatureEditor as LegacyBrepFeatureEditor } from '@/components/brep/BrepFeatureEditorLegacy';
import { BrepMultiLoopProfileEditor } from '@/components/brep/BrepMultiLoopProfileEditor';
import type { BrepNode, BrepProject } from '@shared/brepProject';

export function BrepFeatureEditor({
  project,
  disabled,
  saving,
  onSaveNode,
  onSaveProject,
}: {
  project: BrepProject;
  disabled: boolean;
  saving: boolean;
  onSaveNode: (node: BrepNode) => Promise<void>;
  onSaveProject: (project: BrepProject) => Promise<void>;
}) {
  return (
    <>
      <LegacyBrepFeatureEditor
        project={project}
        disabled={disabled}
        saving={saving}
        onSaveNode={onSaveNode}
        onSaveProject={onSaveProject}
      />
      <BrepMultiLoopProfileEditor
        project={project}
        disabled={disabled}
        saving={saving}
        onSaveNode={onSaveNode}
      />
    </>
  );
}
