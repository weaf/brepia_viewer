import { BrepProjectDefinitionEditor as BrepProjectDefinitionFieldsEditor } from '@/components/brep/BrepProjectDefinitionFieldsEditor';
import { BrepProjectObjectEditor } from '@/components/brep/BrepProjectObjectEditor';
import type { BrepProject } from '@shared/brepProject';

/**
 * Compose the accepted Phase 4D project-definition editor with Phase 5C
 * project-object authoring without coupling either editor to persistence.
 */
export function BrepProjectDefinitionEditor({
  project,
  disabled,
  saving,
  onSaveProject,
}: {
  project: BrepProject;
  disabled: boolean;
  saving: boolean;
  onSaveProject: (project: BrepProject) => Promise<void>;
}) {
  return (
    <div className="grid gap-4">
      <BrepProjectDefinitionFieldsEditor
        project={project}
        disabled={disabled}
        saving={saving}
        onSaveProject={onSaveProject}
      />
      <div className="border-t border-adam-neutral-700/60 pt-4">
        <BrepProjectObjectEditor
          project={project}
          disabled={disabled}
          saving={saving}
          onSaveProject={onSaveProject}
        />
      </div>
    </div>
  );
}
