import {
  ghxChunk,
  ghxChunks,
  ghxItemText,
  parseBrepGrasshopperGhxArchive,
  BrepGrasshopperGhxArchiveError,
  type BrepGrasshopperGhxArchiveNode,
} from './brepGrasshopperGhxArchive.ts';
import {
  BREP_GRASSHOPPER_GHX_NUMBER_PARAMETER_GUID,
  BREP_GRASSHOPPER_GHX_NUMBER_SLIDER_GUID,
} from './brepGrasshopperGhx.ts';
import type { BrepGrasshopperAccess } from './brepGrasshopperContract.ts';
import { createBrepGrasshopperPackagePlan } from './brepGrasshopperPackagePlan.ts';
import {
  BREP_GRASSHOPPER_RHINO_PYTHON3_COMPONENT_GUID,
  BREP_GRASSHOPPER_RHINOCODE_LIBRARY_GUID,
  BREP_GRASSHOPPER_SCRIPT_OBJECT_HINT_GUID,
  BREP_GRASSHOPPER_SCRIPT_PARAMETER_GUID,
  createBrepGrasshopperRhinoScriptPlan,
  type BrepGrasshopperRhinoScriptInput,
  type BrepGrasshopperRhinoScriptOutput,
  type BrepGrasshopperRhinoScriptPlan,
} from './brepGrasshopperRhinoScript.ts';

const SYSTEM_CORELIB = 'System.Private.CoreLib';

type BrepGrasshopperExecutableGhxValidationMode = 'generated' | 'returned';

export type BrepGrasshopperExecutableGhxDiagnostic = {
  code: string;
  severity: 'error';
  message: string;
  path?: string;
};

export type BrepGrasshopperExecutableGhxValidationResult = {
  accepted: boolean;
  compatibility: 'supported' | 'unsupported';
  diagnostics: BrepGrasshopperExecutableGhxDiagnostic[];
  parameters: Record<string, number>;
};

function error(
  diagnostics: BrepGrasshopperExecutableGhxDiagnostic[],
  code: string,
  message: string,
  path?: string,
): void {
  diagnostics.push({ code, severity: 'error', message, ...(path ? { path } : {}) });
}

function parseFinite(value: string | undefined): number | undefined {
  if (value == null || value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function guidText(
  parent: BrepGrasshopperGhxArchiveNode,
  name: string,
  index?: string,
): string | undefined {
  return ghxItemText(parent, name, index)?.toLowerCase();
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const combined = (a << 16) | (b << 8) | c;
    result += alphabet[(combined >> 18) & 63];
    result += alphabet[(combined >> 12) & 63];
    result += index + 1 < bytes.length ? alphabet[(combined >> 6) & 63] : '=';
    result += index + 2 < bytes.length ? alphabet[combined & 63] : '=';
  }
  return result;
}

function expectedSourceBase64(source: string): string {
  return bytesToBase64(new TextEncoder().encode(source));
}

function objectContainer(
  object: BrepGrasshopperGhxArchiveNode,
): BrepGrasshopperGhxArchiveNode | undefined {
  return ghxChunk(object, 'Container');
}

function validateNumericControl(
  object: BrepGrasshopperGhxArchiveNode,
  expectedByGuid: ReadonlyMap<
    string,
    Awaited<ReturnType<typeof createBrepGrasshopperPackagePlan>>['controls'][number]
  >,
  mode: BrepGrasshopperExecutableGhxValidationMode,
  seen: Set<string>,
  parameters: Record<string, number>,
  diagnostics: BrepGrasshopperExecutableGhxDiagnostic[],
  path: string,
): void {
  const componentGuid = guidText(object, 'GUID');
  const container = objectContainer(object);
  const instanceGuid = container ? guidText(container, 'InstanceGuid') : undefined;
  if (!container || !instanceGuid) {
    error(
      diagnostics,
      'invalid_control',
      'Numeric control is missing Container/InstanceGuid.',
      path,
    );
    return;
  }
  const expected = expectedByGuid.get(instanceGuid);
  if (!expected) {
    error(
      diagnostics,
      'unexpected_control',
      `Numeric control ${instanceGuid} is not owned by the expected Brepia project.`,
      path,
    );
    return;
  }
  if (seen.has(instanceGuid)) {
    error(
      diagnostics,
      'duplicate_control',
      `Duplicate numeric control ${instanceGuid}.`,
      path,
    );
    return;
  }
  seen.add(instanceGuid);

  const expectedGuid =
    expected.presentation === 'slider'
      ? BREP_GRASSHOPPER_GHX_NUMBER_SLIDER_GUID
      : BREP_GRASSHOPPER_GHX_NUMBER_PARAMETER_GUID;
  if (componentGuid !== expectedGuid) {
    error(
      diagnostics,
      'control_type_changed',
      `Brepia parameter ${expected.inputId} changed Grasshopper control type.`,
      path,
    );
    return;
  }
  if (ghxItemText(container, 'NickName') !== expected.label) {
    error(
      diagnostics,
      'control_identity_changed',
      `Brepia parameter ${expected.inputId} display identity changed.`,
      path,
    );
  }

  let value: number | undefined;
  if (expected.presentation === 'slider') {
    const slider = ghxChunk(container, 'Slider');
    const min = slider ? parseFinite(ghxItemText(slider, 'Min')) : undefined;
    const max = slider ? parseFinite(ghxItemText(slider, 'Max')) : undefined;
    value = slider ? parseFinite(ghxItemText(slider, 'Value')) : undefined;
    if (
      slider == null ||
      min == null ||
      max == null ||
      value == null ||
      min !== expected.min ||
      max !== expected.max ||
      min >= max ||
      value < min ||
      value > max
    ) {
      error(
        diagnostics,
        'invalid_slider_state',
        `Brepia parameter ${expected.inputId} slider bounds/value are invalid or changed.`,
        path,
      );
      return;
    }
  } else {
    const persistent = ghxChunk(container, 'PersistentData');
    const branch = persistent ? ghxChunk(persistent, 'Branch', '0') : undefined;
    const stored = branch ? ghxChunk(branch, 'Item', '0') : undefined;
    value = stored ? parseFinite(ghxItemText(stored, 'number')) : undefined;
    if (value == null) {
      error(
        diagnostics,
        'invalid_number_state',
        `Brepia parameter ${expected.inputId} persistent value is invalid.`,
        path,
      );
      return;
    }
  }

  if (expected.min != null && value < expected.min) {
    error(
      diagnostics,
      'parameter_out_of_bounds',
      `Brepia parameter ${expected.inputId} is below its canonical minimum.`,
      path,
    );
  }
  if (expected.max != null && value > expected.max) {
    error(
      diagnostics,
      'parameter_out_of_bounds',
      `Brepia parameter ${expected.inputId} exceeds its canonical maximum.`,
      path,
    );
  }
  if (mode === 'generated' && value !== expected.default) {
    error(
      diagnostics,
      'generated_default_mismatch',
      `Generated Brepia parameter ${expected.inputId} differs from its canonical default.`,
      path,
    );
  }
  parameters[expected.inputId] = value;
}

function validateInput(
  parameterData: BrepGrasshopperGhxArchiveNode,
  expected: BrepGrasshopperRhinoScriptInput,
  index: number,
  diagnostics: BrepGrasshopperExecutableGhxDiagnostic[],
): void {
  const path = `script/input:${expected.inputId}`;
  if (
    guidText(parameterData, 'InputId', String(index)) !==
    BREP_GRASSHOPPER_SCRIPT_PARAMETER_GUID
  ) {
    error(
      diagnostics,
      'script_input_type_changed',
      `Script input ${expected.inputId} parameter type changed.`,
      path,
    );
  }
  const input = ghxChunk(parameterData, 'InputParam', String(index));
  if (!input) {
    error(
      diagnostics,
      'missing_script_input',
      `Script input ${expected.inputId} is missing.`,
      path,
    );
    return;
  }
  if (guidText(input, 'InstanceGuid') !== expected.instanceGuid.toLowerCase()) {
    error(
      diagnostics,
      'script_input_identity_changed',
      `Script input ${expected.inputId} identity changed.`,
      path,
    );
  }
  if (
    ghxItemText(input, 'Name') !== expected.variableName ||
    ghxItemText(input, 'NickName') !== expected.nickname
  ) {
    error(
      diagnostics,
      'script_input_identity_changed',
      `Script input ${expected.inputId} name changed.`,
      path,
    );
  }
  const expectedSourceCount = expected.sourceObjectGuid ? '1' : '0';
  if (ghxItemText(input, 'SourceCount') !== expectedSourceCount) {
    error(
      diagnostics,
      'script_rewired',
      `Script input ${expected.inputId} source count changed.`,
      path,
    );
  }
  const source = guidText(input, 'Source', '0');
  if (
    expected.sourceObjectGuid
      ? source !== expected.sourceObjectGuid.toLowerCase()
      : source != null
  ) {
    error(
      diagnostics,
      'script_rewired',
      `Script input ${expected.inputId} was rewired.`,
      path,
    );
  }
  if (guidText(input, 'TypeHintID') !== expected.typeHintGuid.toLowerCase()) {
    error(
      diagnostics,
      'script_input_type_changed',
      `Script input ${expected.inputId} type hint changed.`,
      path,
    );
  }
  const converter = ghxChunk(input, 'ConverterData');
  if (
    !converter ||
    ghxItemText(converter, 'AssemblyName') !== SYSTEM_CORELIB ||
    ghxItemText(converter, 'TypeName') !== expected.converterType
  ) {
    error(
      diagnostics,
      'script_input_type_changed',
      `Script input ${expected.inputId} converter changed.`,
      path,
    );
  }
}

function validateOutput(
  parameterData: BrepGrasshopperGhxArchiveNode,
  expected: BrepGrasshopperRhinoScriptOutput,
  expectedAccess: BrepGrasshopperAccess,
  index: number,
  diagnostics: BrepGrasshopperExecutableGhxDiagnostic[],
): void {
  const path = `script/output:${expected.outputId}`;
  if (
    guidText(parameterData, 'OutputId', String(index)) !==
    BREP_GRASSHOPPER_SCRIPT_PARAMETER_GUID
  ) {
    error(
      diagnostics,
      'script_output_type_changed',
      `Script output ${expected.outputId} parameter type changed.`,
      path,
    );
  }
  const output = ghxChunk(parameterData, 'OutputParam', String(index));
  if (!output) {
    error(
      diagnostics,
      'missing_script_output',
      `Script output ${expected.outputId} is missing.`,
      path,
    );
    return;
  }
  if (guidText(output, 'InstanceGuid') !== expected.instanceGuid.toLowerCase()) {
    error(
      diagnostics,
      'script_output_identity_changed',
      `Script output ${expected.outputId} identity changed.`,
      path,
    );
  }
  if (
    ghxItemText(output, 'Name') !== expected.variableName ||
    ghxItemText(output, 'NickName') !== expected.nickname
  ) {
    error(
      diagnostics,
      'script_output_identity_changed',
      `Script output ${expected.outputId} name changed.`,
      path,
    );
  }
  const expectedParamAccess =
    expected.outputId === 'result' && expectedAccess === 'list' ? '1' : '0';
  if (ghxItemText(output, 'ScriptParamAccess') !== expectedParamAccess) {
    error(
      diagnostics,
      'script_output_access_changed',
      `Script output ${expected.outputId} parameter access changed.`,
      path,
    );
  }
  if (ghxItemText(output, 'SourceCount') !== '0') {
    error(
      diagnostics,
      'script_output_rewired',
      `Script output ${expected.outputId} unexpectedly has a source.`,
      path,
    );
  }
  const converter = ghxChunk(output, 'ConverterData');
  if (
    guidText(output, 'TypeHintID') !== BREP_GRASSHOPPER_SCRIPT_OBJECT_HINT_GUID ||
    !converter ||
    ghxItemText(converter, 'AssemblyName') !== SYSTEM_CORELIB ||
    ghxItemText(converter, 'TypeName') !== 'System.Object'
  ) {
    error(
      diagnostics,
      'script_output_type_changed',
      `Script output ${expected.outputId} converter or type hint changed.`,
      path,
    );
  }
}

function validateHostEnvelope(
  root: BrepGrasshopperGhxArchiveNode,
  definition: BrepGrasshopperGhxArchiveNode,
  mode: BrepGrasshopperExecutableGhxValidationMode,
  diagnostics: BrepGrasshopperExecutableGhxDiagnostic[],
): void {
  if (!ghxChunk(root, 'Thumbnail')) {
    error(
      diagnostics,
      'missing_thumbnail',
      'Executable GHX is missing the Grasshopper Thumbnail archive chunk.',
    );
  }

  const libraries = ghxChunk(definition, 'GHALibraries');
  if (!libraries) {
    error(
      diagnostics,
      'missing_gha_libraries',
      'Executable GHX is missing the Grasshopper GHALibraries archive chunk.',
    );
    return;
  }

  const libraryEntries = ghxChunks(libraries, 'Library');
  const hasRhinoCode = libraryEntries.some(
    (library) =>
      guidText(library, 'Id') === BREP_GRASSHOPPER_RHINOCODE_LIBRARY_GUID,
  );
  if (mode === 'generated' && !hasRhinoCode) {
    error(
      diagnostics,
      'missing_rhinocode_library',
      'Executable GHX does not declare the RhinoCodePluginGH library required by its Python 3 Script.',
    );
  }

  if (mode === 'returned') {
    const claimsRhinoCodeByName = libraryEntries.some(
      (library) => ghxItemText(library, 'Name') === 'RhinoCodePluginGH',
    );
    if (claimsRhinoCodeByName && !hasRhinoCode) {
      error(
        diagnostics,
        'rhinocode_library_identity_changed',
        'Returned GHX declares RhinoCodePluginGH with an unexpected library identity.',
      );
    }
  }
}

function validateScript(
  object: BrepGrasshopperGhxArchiveNode,
  expected: BrepGrasshopperRhinoScriptPlan,
  outputAccess: ReadonlyMap<string, BrepGrasshopperAccess>,
  mode: BrepGrasshopperExecutableGhxValidationMode,
  diagnostics: BrepGrasshopperExecutableGhxDiagnostic[],
): void {
  const path = 'DefinitionObjects/BrepiaScript';
  if (
    guidText(object, 'GUID') !==
    BREP_GRASSHOPPER_RHINO_PYTHON3_COMPONENT_GUID
  ) {
    error(
      diagnostics,
      'script_type_changed',
      'Brepia Python 3 Script component type changed.',
      path,
    );
  }

  const scriptLibrary = guidText(object, 'Lib');
  const invalidScriptLibrary =
    mode === 'generated'
      ? scriptLibrary !== BREP_GRASSHOPPER_RHINOCODE_LIBRARY_GUID
      : scriptLibrary != null &&
        scriptLibrary !== BREP_GRASSHOPPER_RHINOCODE_LIBRARY_GUID;
  if (invalidScriptLibrary) {
    error(
      diagnostics,
      'script_library_changed',
      'Brepia Python 3 Script library identity changed.',
      path,
    );
  }

  const container = objectContainer(object);
  if (!container) {
    error(
      diagnostics,
      'missing_script_container',
      'Brepia Python 3 Script Container is missing.',
      path,
    );
    return;
  }
  if (
    guidText(container, 'InstanceGuid') !==
    expected.componentInstanceGuid.toLowerCase()
  ) {
    error(
      diagnostics,
      'script_identity_changed',
      'Brepia Python 3 Script instance identity changed.',
      path,
    );
  }
  if (
    ghxItemText(container, 'Name') !== 'Python 3 Script' ||
    ghxItemText(container, 'NickName') !== expected.componentNickname ||
    ghxItemText(container, 'GraftStandardOutputLines') !== 'true' ||
    ghxItemText(container, 'MarshGuids') !== 'true' ||
    ghxItemText(container, 'MarshInputs') !== 'true' ||
    ghxItemText(container, 'MarshOutputs') !== 'true' ||
    ghxItemText(container, 'UsingLibraryInputParam') !== 'false' ||
    ghxItemText(container, 'UsingScriptInputParam') !== 'false' ||
    ghxItemText(container, 'UsingScriptOutputParam') !== 'false' ||
    ghxItemText(container, 'UsingStandardOutputParam') !== 'false'
  ) {
    error(
      diagnostics,
      'script_runtime_settings_changed',
      'Brepia Python 3 Script runtime settings changed.',
      path,
    );
  }
  if (ghxItemText(container, 'ScriptComponentVersion') !== '3') {
    error(
      diagnostics,
      'script_version_changed',
      'Brepia Python 3 Script persistence version changed.',
      path,
    );
  }

  const parameterData = ghxChunk(container, 'ParameterData');
  if (!parameterData) {
    error(
      diagnostics,
      'missing_script_parameters',
      'Brepia Python 3 Script ParameterData is missing.',
      path,
    );
    return;
  }
  if (
    ghxItemText(parameterData, 'InputCount') !== String(expected.inputs.length) ||
    ghxChunks(parameterData, 'InputParam').length !== expected.inputs.length
  ) {
    error(
      diagnostics,
      'script_input_count_changed',
      'Brepia Python 3 Script input count changed.',
      path,
    );
  }
  if (
    ghxItemText(parameterData, 'OutputCount') !==
      String(expected.outputs.length) ||
    ghxChunks(parameterData, 'OutputParam').length !== expected.outputs.length
  ) {
    error(
      diagnostics,
      'script_output_count_changed',
      'Brepia Python 3 Script output count changed.',
      path,
    );
  }
  expected.inputs.forEach((input, index) =>
    validateInput(parameterData, input, index, diagnostics),
  );
  expected.outputs.forEach((output, index) =>
    validateOutput(
      parameterData,
      output,
      outputAccess.get(output.outputId) ?? 'item',
      index,
      diagnostics,
    ),
  );

  const script = ghxChunk(container, 'Script');
  if (!script) {
    error(
      diagnostics,
      'missing_script_source',
      'Brepia Python 3 Script source chunk is missing.',
      path,
    );
    return;
  }
  if (
    ghxItemText(script, 'MarshGuids') !== 'true' ||
    ghxItemText(script, 'MarshInputs') !== 'true' ||
    ghxItemText(script, 'MarshOutputs') !== 'true' ||
    ghxItemText(script, 'Title') !== 'Brepia'
  ) {
    error(
      diagnostics,
      'script_runtime_settings_changed',
      'Embedded Brepia Python 3 Script settings changed.',
      path,
    );
  }
  if (ghxItemText(script, 'Text') !== expectedSourceBase64(expected.source)) {
    error(
      diagnostics,
      'script_source_changed',
      'Embedded Brepia Python source changed and is not safe for automatic round-trip.',
      path,
    );
  }
  const language = ghxChunk(script, 'LanguageSpec');
  if (
    !language ||
    ghxItemText(language, 'Taxon') !== '*.*.python' ||
    ghxItemText(language, 'Version') !== '3.*'
  ) {
    error(
      diagnostics,
      'script_language_changed',
      'Brepia script language/version changed.',
      path,
    );
  }
}

export async function validateBrepGrasshopperExecutableGhx(
  input: string,
  expectedContract: unknown,
  mode: BrepGrasshopperExecutableGhxValidationMode = 'generated',
): Promise<BrepGrasshopperExecutableGhxValidationResult> {
  const diagnostics: BrepGrasshopperExecutableGhxDiagnostic[] = [];
  const parameters: Record<string, number> = {};
  let root: BrepGrasshopperGhxArchiveNode;
  try {
    root = parseBrepGrasshopperGhxArchive(input);
  } catch (caught) {
    if (caught instanceof BrepGrasshopperGhxArchiveError) {
      error(diagnostics, caught.code, caught.message);
    } else {
      error(diagnostics, 'malformed_xml', 'GHX could not be parsed safely.');
    }
    return {
      accepted: false,
      compatibility: 'unsupported',
      diagnostics,
      parameters,
    };
  }

  if (root.name !== 'Archive' || root.attributes.name !== 'Root') {
    error(diagnostics, 'invalid_root', 'GHX root must be Archive name="Root".');
  }
  const definition = ghxChunk(root, 'Definition');
  const definitionObjects = definition
    ? ghxChunk(definition, 'DefinitionObjects')
    : undefined;
  if (!definition || !definitionObjects) {
    error(
      diagnostics,
      'missing_definition_objects',
      'GHX DefinitionObjects chunk is missing.',
    );
    return {
      accepted: false,
      compatibility: 'unsupported',
      diagnostics,
      parameters,
    };
  }
  validateHostEnvelope(root, definition, mode, diagnostics);

  let packagePlan;
  let scriptPlan;
  try {
    [packagePlan, scriptPlan] = await Promise.all([
      createBrepGrasshopperPackagePlan(expectedContract),
      createBrepGrasshopperRhinoScriptPlan(expectedContract),
    ]);
  } catch (caught) {
    error(
      diagnostics,
      'invalid_expected_contract',
      `Expected Brepia contract cannot produce the supported GHX subset: ${
        caught instanceof Error ? caught.message : String(caught)
      }`,
    );
    return {
      accepted: false,
      compatibility: 'unsupported',
      diagnostics,
      parameters,
    };
  }

  const outputAccess = new Map<string, BrepGrasshopperAccess>(
    packagePlan.contract.interface.outputs.map((output) => [
      output.id,
      output.access,
    ]),
  );
  const objects = ghxChunks(definitionObjects, 'Object');
  const declared = Number.parseInt(
    ghxItemText(definitionObjects, 'ObjectCount') ?? '',
    10,
  );
  if (!Number.isSafeInteger(declared) || declared !== objects.length) {
    error(
      diagnostics,
      'object_count_mismatch',
      'GHX ObjectCount does not match serialized objects.',
    );
  }
  if (objects.length !== packagePlan.controls.length + 1) {
    error(
      diagnostics,
      'unexpected_graph_objects',
      'Returned GHX contains objects outside the strict Brepia v1 round-trip graph.',
    );
  }

  const expectedControls = new Map(
    packagePlan.controls.map((control) => [
      control.instanceGuid.toLowerCase(),
      control,
    ]),
  );
  const seenControls = new Set<string>();
  let scriptCount = 0;

  objects.forEach((object, index) => {
    if (object.attributes.index !== String(index)) {
      error(
        diagnostics,
        'object_index_mismatch',
        `Grasshopper object index ${object.attributes.index ?? '(missing)'} does not match expected index ${index}.`,
        `DefinitionObjects/Object[${index}]`,
      );
    }
    const guid = guidText(object, 'GUID');
    if (
      guid === BREP_GRASSHOPPER_GHX_NUMBER_SLIDER_GUID ||
      guid === BREP_GRASSHOPPER_GHX_NUMBER_PARAMETER_GUID
    ) {
      validateNumericControl(
        object,
        expectedControls,
        mode,
        seenControls,
        parameters,
        diagnostics,
        `DefinitionObjects/Object[${index}]`,
      );
      return;
    }
    if (guid === BREP_GRASSHOPPER_RHINO_PYTHON3_COMPONENT_GUID) {
      scriptCount += 1;
      if (scriptCount > 1) {
        error(
          diagnostics,
          'duplicate_script',
          'GHX contains more than one Brepia Python 3 Script.',
        );
      } else {
        validateScript(object, scriptPlan, outputAccess, mode, diagnostics);
      }
      return;
    }
    error(
      diagnostics,
      'unsupported_object',
      `Grasshopper object ${guid ?? '(missing GUID)'} is outside the strict Brepia v1 graph.`,
      `DefinitionObjects/Object[${index}]`,
    );
  });

  for (const control of packagePlan.controls) {
    if (!seenControls.has(control.instanceGuid.toLowerCase())) {
      error(
        diagnostics,
        'missing_parameter_control',
        `Expected Brepia parameter control ${control.inputId} is missing.`,
      );
    }
  }
  if (scriptCount !== 1) {
    error(
      diagnostics,
      'missing_script',
      'Expected exactly one Brepia Python 3 Script component.',
    );
  }

  const accepted = diagnostics.length === 0;
  return {
    accepted,
    compatibility: accepted ? 'supported' : 'unsupported',
    diagnostics,
    parameters,
  };
}
