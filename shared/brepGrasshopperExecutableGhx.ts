import {
  compileBrepGrasshopperParameterShellGhx,
} from './brepGrasshopperGhx.ts';
import type { BrepGrasshopperAccess } from './brepGrasshopperContract.ts';
import { createBrepGrasshopperPackagePlan } from './brepGrasshopperPackagePlan.ts';
import {
  BREP_GRASSHOPPER_RHINO_PYTHON3_COMPONENT_GUID,
  BREP_GRASSHOPPER_RHINOCODE_LIBRARY_GUID,
  BREP_GRASSHOPPER_SCRIPT_PARAMETER_GUID,
  createBrepGrasshopperRhinoScriptPlan,
  type BrepGrasshopperRhinoScriptInput,
  type BrepGrasshopperRhinoScriptOutput,
  type BrepGrasshopperRhinoScriptPlan,
} from './brepGrasshopperRhinoScript.ts';

const SCRIPT_COMPONENT_VERSION = 3;
const SCRIPT_COMPONENT_WIDTH = 220;
const SCRIPT_ROW_HEIGHT = 24;
const SCRIPT_MIN_HEIGHT = 64;
const RHINO_SDK_VERSION = '8.34.26223.11001';
const THUMBNAIL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

function sourceTextBase64(source: string): string {
  return bytesToBase64(new TextEncoder().encode(source));
}

function inputParamXml(
  input: BrepGrasshopperRhinoScriptInput,
  index: number,
  x: number,
  y: number,
): string {
  const sourceItems = input.sourceObjectGuid
    ? `<item name="Source" index="0" type_name="gh_guid" type_code="9">${input.sourceObjectGuid}</item>`
    : '';
  const sourceCount = input.sourceObjectGuid ? 1 : 0;
  const description =
    input.kind === 'number'
      ? 'Brepia published numeric parameter'
      : 'Optional target Plane. Unconnected uses Brepia project placement.';

  return `<chunk name="InputParam" index="${index}"><items count="${12 + sourceCount}"><item name="AllowTreeAccess" type_name="gh_bool" type_code="1">false</item><item name="Description" type_name="gh_string" type_code="10">${escapeXml(description)}</item><item name="InstanceGuid" type_name="gh_guid" type_code="9">${input.instanceGuid}</item><item name="Name" type_name="gh_string" type_code="10">${input.variableName}</item><item name="NickName" type_name="gh_string" type_code="10">${escapeXml(input.nickname)}</item><item name="Optional" type_name="gh_bool" type_code="1">${input.kind === 'placement' ? 'true' : 'false'}</item><item name="ScriptParamAccess" type_name="gh_int32" type_code="3">0</item><item name="ScriptParameterVersion" type_name="gh_int32" type_code="3">2</item><item name="ShowTypeHints" type_name="gh_bool" type_code="1">true</item>${sourceItems}<item name="SourceCount" type_name="gh_int32" type_code="3">${sourceCount}</item><item name="ToolTip" type_name="gh_string" type_code="10"></item><item name="TypeHintID" type_name="gh_guid" type_code="9">${input.typeHintGuid}</item></items><chunks count="2"><chunk name="Attributes"><items count="2"><item name="Bounds" type_name="gh_drawing_rectanglef" type_code="35"><X>${x}</X><Y>${y}</Y><W>70</W><H>24</H></item><item name="Pivot" type_name="gh_drawing_pointf" type_code="31"><X>${x + 8}</X><Y>${y + 12}</Y></item></items></chunk><chunk name="ConverterData"><items count="2"><item name="AssemblyName" type_name="gh_string" type_code="10">System.Private.CoreLib</item><item name="TypeName" type_name="gh_string" type_code="10">${input.converterType}</item></items></chunk></chunks></chunk>`;
}

function outputParamXml(
  output: BrepGrasshopperRhinoScriptOutput,
  access: BrepGrasshopperAccess,
  index: number,
  x: number,
  y: number,
): string {
  // M3B changes only the primary Result persistence shape. Existing semantic
  // point outputs keep the installed-host-accepted Item persistence even though
  // their portable contract describes list semantics.
  const scriptParamAccess =
    output.outputId === 'result' && access === 'list' ? 1 : 0;
  return `<chunk name="OutputParam" index="${index}"><items count="12"><item name="AllowTreeAccess" type_name="gh_bool" type_code="1">false</item><item name="Description" type_name="gh_string" type_code="10">Brepia ${escapeXml(output.nickname)} output</item><item name="InstanceGuid" type_name="gh_guid" type_code="9">${output.instanceGuid}</item><item name="Name" type_name="gh_string" type_code="10">${output.variableName}</item><item name="NickName" type_name="gh_string" type_code="10">${escapeXml(output.nickname)}</item><item name="Optional" type_name="gh_bool" type_code="1">false</item><item name="ScriptParamAccess" type_name="gh_int32" type_code="3">${scriptParamAccess}</item><item name="ScriptParameterVersion" type_name="gh_int32" type_code="3">2</item><item name="ShowTypeHints" type_name="gh_bool" type_code="1">true</item><item name="SourceCount" type_name="gh_int32" type_code="3">0</item><item name="ToolTip" type_name="gh_string" type_code="10"></item><item name="TypeHintID" type_name="gh_guid" type_code="9">6a184b65-baa3-42d1-a548-3915b401de53</item></items><chunks count="2"><chunk name="Attributes"><items count="2"><item name="Bounds" type_name="gh_drawing_rectanglef" type_code="35"><X>${x}</X><Y>${y}</Y><W>92</W><H>24</H></item><item name="Pivot" type_name="gh_drawing_pointf" type_code="31"><X>${x + 84}</X><Y>${y + 12}</Y></item></items></chunk><chunk name="ConverterData"><items count="2"><item name="AssemblyName" type_name="gh_string" type_code="10">System.Private.CoreLib</item><item name="TypeName" type_name="gh_string" type_code="10">System.Object</item></items></chunk></chunks></chunk>`;
}

function scriptObjectXml(
  script: BrepGrasshopperRhinoScriptPlan,
  outputAccess: ReadonlyMap<string, BrepGrasshopperAccess>,
  pivot: { x: number; y: number },
  objectIndex: number,
): string {
  const rowCount = Math.max(script.inputs.length, script.outputs.length);
  const height = Math.max(SCRIPT_MIN_HEIGHT, rowCount * SCRIPT_ROW_HEIGHT + 8);
  const x = pivot.x;
  const y = pivot.y - height / 2;
  const inputX = x + 2;
  const outputX = x + SCRIPT_COMPONENT_WIDTH - 94;
  const firstRowY = y + 4;
  const inputs = script.inputs
    .map((input, index) =>
      inputParamXml(input, index, inputX, firstRowY + index * SCRIPT_ROW_HEIGHT),
    )
    .join('');
  const outputs = script.outputs
    .map((output, index) =>
      outputParamXml(
        output,
        outputAccess.get(output.outputId) ?? 'item',
        index,
        outputX,
        firstRowY + index * SCRIPT_ROW_HEIGHT,
      ),
    )
    .join('');
  const inputIds = script.inputs
    .map(
      (_, index) =>
        `<item name="InputId" index="${index}" type_name="gh_guid" type_code="9">${BREP_GRASSHOPPER_SCRIPT_PARAMETER_GUID}</item>`,
    )
    .join('');
  const outputIds = script.outputs
    .map(
      (_, index) =>
        `<item name="OutputId" index="${index}" type_name="gh_guid" type_code="9">${BREP_GRASSHOPPER_SCRIPT_PARAMETER_GUID}</item>`,
    )
    .join('');
  const parameterItems = 2 + script.inputs.length + script.outputs.length;

  return `<chunk name="Object" index="${objectIndex}"><items count="3"><item name="GUID" type_name="gh_guid" type_code="9">${BREP_GRASSHOPPER_RHINO_PYTHON3_COMPONENT_GUID}</item><item name="Lib" type_name="gh_guid" type_code="9">${BREP_GRASSHOPPER_RHINOCODE_LIBRARY_GUID}</item><item name="Name" type_name="gh_string" type_code="10">Python 3 Script</item></items><chunks count="1"><chunk name="Container"><items count="14"><item name="Description" type_name="gh_string" type_code="10">Brepia self-contained RhinoCommon model</item><item name="GraftStandardOutputLines" type_name="gh_bool" type_code="1">true</item><item name="InstanceGuid" type_name="gh_guid" type_code="9">${script.componentInstanceGuid}</item><item name="MarshGuids" type_name="gh_bool" type_code="1">true</item><item name="MarshInputs" type_name="gh_bool" type_code="1">true</item><item name="MarshOutputs" type_name="gh_bool" type_code="1">true</item><item name="Name" type_name="gh_string" type_code="10">Python 3 Script</item><item name="NickName" type_name="gh_string" type_code="10">${escapeXml(script.componentNickname)}</item><item name="ScriptComponentVersion" type_name="gh_int32" type_code="3">${SCRIPT_COMPONENT_VERSION}</item><item name="Tooltip" type_name="gh_string" type_code="10">Brepia project ${escapeXml(script.projectId)}</item><item name="UsingLibraryInputParam" type_name="gh_bool" type_code="1">false</item><item name="UsingScriptInputParam" type_name="gh_bool" type_code="1">false</item><item name="UsingScriptOutputParam" type_name="gh_bool" type_code="1">false</item><item name="UsingStandardOutputParam" type_name="gh_bool" type_code="1">false</item></items><chunks count="3"><chunk name="Attributes"><items count="2"><item name="Bounds" type_name="gh_drawing_rectanglef" type_code="35"><X>${x}</X><Y>${y}</Y><W>${SCRIPT_COMPONENT_WIDTH}</W><H>${height}</H></item><item name="Pivot" type_name="gh_drawing_pointf" type_code="31"><X>${x + SCRIPT_COMPONENT_WIDTH / 2}</X><Y>${pivot.y}</Y></item></items></chunk><chunk name="ParameterData"><items count="${parameterItems}"><item name="InputCount" type_name="gh_int32" type_code="3">${script.inputs.length}</item>${inputIds}<item name="OutputCount" type_name="gh_int32" type_code="3">${script.outputs.length}</item>${outputIds}</items><chunks count="${script.inputs.length + script.outputs.length}">${inputs}${outputs}</chunks></chunk><chunk name="Script"><items count="5"><item name="MarshGuids" type_name="gh_bool" type_code="1">true</item><item name="MarshInputs" type_name="gh_bool" type_code="1">true</item><item name="MarshOutputs" type_name="gh_bool" type_code="1">true</item><item name="Text" type_name="gh_string" type_code="10">${sourceTextBase64(script.source)}</item><item name="Title" type_name="gh_string" type_code="10">Brepia</item></items><chunks count="1"><chunk name="LanguageSpec"><items count="2"><item name="Taxon" type_name="gh_string" type_code="10">*.*.python</item><item name="Version" type_name="gh_string" type_code="10">3.*</item></items></chunk></chunks></chunk></chunks></chunk></chunks></chunk>`;
}

function injectScriptObject(
  shell: string,
  scriptXml: string,
  controlCount: number,
): string {
  const header = `<chunk name="DefinitionObjects"><items count="1"><item name="ObjectCount" type_name="gh_int32" type_code="3">${controlCount}</item></items><chunks count="${controlCount}">`;
  const updatedHeader = `<chunk name="DefinitionObjects"><items count="1"><item name="ObjectCount" type_name="gh_int32" type_code="3">${controlCount + 1}</item></items><chunks count="${controlCount + 1}">`;
  if (!shell.includes(header)) {
    throw new Error('Brepia GHX parameter-shell DefinitionObjects header changed unexpectedly.');
  }
  const suffix = '</chunks></chunk></chunks></chunk></chunks></Archive>';
  const suffixIndex = shell.lastIndexOf(suffix);
  if (suffixIndex < 0) {
    throw new Error('Brepia GHX parameter-shell closing structure changed unexpectedly.');
  }
  const withHeader = shell.replace(header, updatedHeader);
  const adjustedSuffixIndex = withHeader.lastIndexOf(suffix);
  return `${withHeader.slice(0, adjustedSuffixIndex)}${scriptXml}${withHeader.slice(
    adjustedSuffixIndex,
  )}`;
}

function hostLibrariesXml(): string {
  return `<chunk name="GHALibraries"><items count="1"><item name="Count" type_name="gh_int32" type_code="3">2</item></items><chunks count="2"><chunk name="Library" index="0"><items count="4"><item name="Author" type_name="gh_string" type_code="10">Robert McNeel &amp; Associates</item><item name="Id" type_name="gh_guid" type_code="9">00000000-0000-0000-0000-000000000000</item><item name="Name" type_name="gh_string" type_code="10">Grasshopper</item><item name="Version" type_name="gh_string" type_code="10">${RHINO_SDK_VERSION}</item></items></chunk><chunk name="Library" index="1"><items count="6"><item name="AssemblyFullName" type_name="gh_string" type_code="10">RhinoCodePluginGH, Version=${RHINO_SDK_VERSION}, Culture=neutral, PublicKeyToken=552281e97c755530</item><item name="AssemblyVersion" type_name="gh_string" type_code="10">${RHINO_SDK_VERSION}</item><item name="Author" type_name="gh_string" type_code="10"></item><item name="Id" type_name="gh_guid" type_code="9">${BREP_GRASSHOPPER_RHINOCODE_LIBRARY_GUID}</item><item name="Name" type_name="gh_string" type_code="10">RhinoCodePluginGH</item><item name="Version" type_name="gh_string" type_code="10"></item></items></chunk></chunks></chunk>`;
}

function upgradeHostEnvelope(ghx: string): string {
  let result = ghx;
  const pluginVersion = '<item name="plugin_version" type_name="gh_version" type_code="80"><Major>1</Major><Minor>0</Minor><Revision>7</Revision></item>';
  result = result.replace(
    pluginVersion,
    '<item name="plugin_version" type_name="gh_version" type_code="80"><Major>1</Major><Minor>0</Minor><Revision>8</Revision></item>',
  );
  result = result.replace(
    '<chunks count="1"><chunk name="Definition">',
    '<chunks count="2"><chunk name="Definition">',
  );
  result = result.replace(
    '<chunk name="Definition"><items count="1"><item name="plugin_version" type_name="gh_version" type_code="80"><Major>1</Major><Minor>0</Minor><Revision>8</Revision></item></items><chunks count="4">',
    '<chunk name="Definition"><items count="1"><item name="plugin_version" type_name="gh_version" type_code="80"><Major>1</Major><Minor>0</Minor><Revision>8</Revision></item></items><chunks count="5">',
  );
  result = result.replace(
    /<chunk name="DocumentHeader"><items count="3">([\s\S]*?<item name="PreviewMeshType" type_name="gh_int32" type_code="3">1<\/item>)<\/items><\/chunk>/,
    '<chunk name="DocumentHeader"><items count="5">$1<item name="PreviewNormal" type_name="gh_drawing_color" type_code="36"><ARGB>100;150;0;0</ARGB></item><item name="PreviewSelected" type_name="gh_drawing_color" type_code="36"><ARGB>100;0;150;0</ARGB></item></items></chunk>',
  );
  result = result.replace(
    '<chunk name="DefinitionProperties"><items count="2"><item name="Description"',
    '<chunk name="DefinitionProperties"><items count="4"><item name="Date" type_name="gh_date" type_code="8">638000000000000000</item><item name="Description"',
  );
  result = result.replace(
    '<item name="Name" type_name="gh_string" type_code="10">',
    '<item name="KeepOpen" type_name="gh_bool" type_code="1">false</item><item name="Name" type_name="gh_string" type_code="10">',
  );
  result = result.replace(
    '<chunk name="DefinitionObjects">',
    `${hostLibrariesXml()}<chunk name="DefinitionObjects">`,
  );
  const rootClose = '</chunks></Archive>';
  const rootCloseIndex = result.lastIndexOf(rootClose);
  if (rootCloseIndex < 0) {
    throw new Error('Brepia GHX root closing structure changed unexpectedly.');
  }
  const thumbnail = `<chunk name="Thumbnail"><items count="1"><item name="Thumbnail" type_name="gh_drawing_bitmap" type_code="37"><bitmap length="68">${THUMBNAIL_PNG_BASE64}</bitmap></item></items></chunk>`;
  return `${result.slice(0, rootCloseIndex)}${thumbnail}${result.slice(rootCloseIndex)}`;
}

/**
 * Phase 8E executable GHX. Phase 9 established the Rhino 8 Python 3 Script
 * persistence shape and document envelope. Later modeling milestones extend
 * only the canonical compiler subset while preserving that host envelope.
 */
export async function compileBrepGrasshopperExecutableGhx(
  value: unknown,
): Promise<string> {
  const [shell, packagePlan, script] = await Promise.all([
    compileBrepGrasshopperParameterShellGhx(value),
    createBrepGrasshopperPackagePlan(value),
    createBrepGrasshopperRhinoScriptPlan(value),
  ]);
  const outputAccess = new Map(
    packagePlan.contract.interface.outputs.map((output) => [output.id, output.access]),
  );
  const executable = injectScriptObject(
    shell,
    scriptObjectXml(
      script,
      outputAccess,
      packagePlan.component.pivot,
      packagePlan.controls.length,
    ),
    packagePlan.controls.length,
  );
  return upgradeHostEnvelope(executable);
}
