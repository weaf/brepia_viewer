import {
  createBrepGrasshopperPackagePlan,
  type BrepGrasshopperNumberControlPlan,
  type BrepGrasshopperPackagePlan,
} from './brepGrasshopperPackagePlan.ts';

export const BREP_GRASSHOPPER_GHX_MAX_BYTES = 4 * 1024 * 1024;
export const BREP_GRASSHOPPER_GHX_NUMBER_SLIDER_GUID =
  '57da07bd-ecab-415d-9d86-af36d7073abc';
export const BREP_GRASSHOPPER_GHX_NUMBER_PARAMETER_GUID =
  '3e8ca6be-fda8-4aaf-b5c0-3c54c8bb7312';

const MAX_XML_NODES = 16_384;
const MAX_XML_DEPTH = 96;
const MAX_XML_ATTRIBUTES = 48;
const MAX_XML_TEXT = BREP_GRASSHOPPER_GHX_MAX_BYTES;
const DOCUMENT_GUID_NAMESPACE = 'brepia-grasshopper-ghx-document-v1';
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
};

export type BrepGrasshopperGhxDiagnostic = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
};

export type BrepGrasshopperGhxObservedParameter = {
  inputId?: string;
  instanceGuid: string;
  presentation: 'slider' | 'number';
  label: string;
  value: number;
};

export type BrepGrasshopperGhxValidationResult = {
  accepted: boolean;
  valid: boolean;
  compatibility: 'supported-subset' | 'unsupported';
  diagnostics: BrepGrasshopperGhxDiagnostic[];
  summary: {
    objectCount: number;
    sliderCount: number;
    numberCount: number;
    parameters: BrepGrasshopperGhxObservedParameter[];
  };
};

export type BrepGrasshopperGhxValidationOptions = {
  expected?: unknown;
  mode?: 'generated' | 'returned';
};

class GhxXmlError extends Error {
  constructor(
    readonly code: 'too_large' | 'unsafe_xml' | 'malformed_xml',
    message: string,
  ) {
    super(message);
    this.name = 'GhxXmlError';
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodeXml(value: string): string {
  const decoded = value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
    (entity) => {
      switch (entity) {
        case '&amp;':
          return '&';
        case '&lt;':
          return '<';
        case '&gt;':
          return '>';
        case '&quot;':
          return '"';
        case '&apos;':
          return "'";
        default: {
          const hex = entity.startsWith('&#x');
          const digits = entity.slice(hex ? 3 : 2, -1);
          const codePoint = Number.parseInt(digits, hex ? 16 : 10);
          if (
            !Number.isSafeInteger(codePoint) ||
            codePoint < 0 ||
            codePoint > 0x10ffff
          ) {
            throw new GhxXmlError(
              'malformed_xml',
              `Invalid XML character entity ${entity}.`,
            );
          }
          return String.fromCodePoint(codePoint);
        }
      }
    },
  );

  if (/&[^\s<]*;/.test(decoded)) {
    throw new GhxXmlError('malformed_xml', 'GHX contains an unsupported XML entity.');
  }
  return decoded;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  let rest = source.trim();
  let count = 0;

  while (rest.length > 0) {
    const match = /^([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2\s*/s.exec(
      rest,
    );
    if (!match) {
      throw new GhxXmlError(
        'malformed_xml',
        `Malformed XML attributes near ${rest.slice(0, 80)}.`,
      );
    }
    const name = match[1];
    const rawValue = match[3];
    if (
      !name ||
      rawValue == null ||
      Object.prototype.hasOwnProperty.call(attributes, name)
    ) {
      throw new GhxXmlError(
        'malformed_xml',
        'Duplicate or invalid XML attribute.',
      );
    }
    attributes[name] = decodeXml(rawValue);
    count += 1;
    if (count > MAX_XML_ATTRIBUTES) {
      throw new GhxXmlError(
        'malformed_xml',
        'XML element has too many attributes.',
      );
    }
    rest = rest.slice(match[0].length);
  }
  return attributes;
}

function findTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < xml.length; index += 1) {
    const char = xml[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '>') return index;
  }
  return -1;
}

function stackTop(stack: XmlNode[]): XmlNode | undefined {
  return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

function parseSafeXml(input: string): XmlNode {
  if (byteLength(input) > BREP_GRASSHOPPER_GHX_MAX_BYTES) {
    throw new GhxXmlError(
      'too_large',
      'GHX exceeds the maximum supported byte length.',
    );
  }
  if (input.includes('\0')) {
    throw new GhxXmlError('unsafe_xml', 'GHX contains a NUL byte.');
  }

  let xml = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) {
    throw new GhxXmlError(
      'unsafe_xml',
      'DOCTYPE, ENTITY and CDATA declarations are not allowed in Brepia GHX.',
    );
  }

  xml = xml.trim();
  if (xml.startsWith('<?xml')) {
    const declarationEnd = xml.indexOf('?>');
    if (declarationEnd < 0) {
      throw new GhxXmlError('malformed_xml', 'Unterminated XML declaration.');
    }
    xml = xml.slice(declarationEnd + 2).trimStart();
  }
  if (xml.includes('<?')) {
    throw new GhxXmlError(
      'unsafe_xml',
      'XML processing instructions are not allowed in Brepia GHX.',
    );
  }

  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  let nodeCount = 0;
  let textCount = 0;
  let cursor = 0;

  while (cursor < xml.length) {
    const open = xml.indexOf('<', cursor);
    if (open < 0) {
      const tail = xml.slice(cursor);
      if (tail.trim().length > 0) {
        const current = stackTop(stack);
        if (!current) {
          throw new GhxXmlError(
            'malformed_xml',
            'Text exists outside the root XML element.',
          );
        }
        const decoded = decodeXml(tail);
        current.text += decoded;
        textCount += decoded.length;
      }
      break;
    }

    if (open > cursor) {
      const rawText = xml.slice(cursor, open);
      const current = stackTop(stack);
      if (!current) {
        if (rawText.trim().length > 0) {
          throw new GhxXmlError(
            'malformed_xml',
            'Text exists outside the root XML element.',
          );
        }
      } else {
        const decoded = decodeXml(rawText);
        current.text += decoded;
        textCount += decoded.length;
      }
      if (textCount > MAX_XML_TEXT) {
        throw new GhxXmlError(
          'malformed_xml',
          'GHX XML text content exceeds the supported limit.',
        );
      }
    }

    if (xml.startsWith('<!--', open)) {
      const commentEnd = xml.indexOf('-->', open + 4);
      if (commentEnd < 0) {
        throw new GhxXmlError('malformed_xml', 'Unterminated XML comment.');
      }
      cursor = commentEnd + 3;
      continue;
    }
    if (xml.startsWith('<!', open)) {
      throw new GhxXmlError(
        'unsafe_xml',
        'Unsupported XML declaration in GHX.',
      );
    }

    const close = findTagEnd(xml, open + 1);
    if (close < 0) {
      throw new GhxXmlError('malformed_xml', 'Unterminated XML element.');
    }
    let tag = xml.slice(open + 1, close).trim();
    cursor = close + 1;

    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name)) {
        throw new GhxXmlError(
          'malformed_xml',
          `Invalid closing XML element ${name}.`,
        );
      }
      const current = stack.pop();
      if (!current || current.name !== name) {
        throw new GhxXmlError(
          'malformed_xml',
          `Mismatched closing XML element ${name}.`,
        );
      }
      continue;
    }

    const selfClosing = tag.endsWith('/');
    if (selfClosing) tag = tag.slice(0, -1).trimEnd();
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s+([\s\S]*))?$/.exec(tag);
    if (!nameMatch?.[1]) {
      throw new GhxXmlError('malformed_xml', 'Invalid XML element name.');
    }

    const node: XmlNode = {
      name: nameMatch[1],
      attributes: parseAttributes(nameMatch[2] ?? ''),
      children: [],
      text: '',
    };
    nodeCount += 1;
    if (nodeCount > MAX_XML_NODES) {
      throw new GhxXmlError(
        'malformed_xml',
        'GHX contains too many XML nodes.',
      );
    }

    const parent = stackTop(stack);
    if (parent) {
      parent.children.push(node);
    } else if (root) {
      throw new GhxXmlError(
        'malformed_xml',
        'GHX must contain exactly one XML root element.',
      );
    } else {
      root = node;
    }

    if (!selfClosing) {
      stack.push(node);
      if (stack.length > MAX_XML_DEPTH) {
        throw new GhxXmlError(
          'malformed_xml',
          'GHX XML nesting exceeds the supported depth.',
        );
      }
    }
  }

  if (!root || stack.length !== 0) {
    throw new GhxXmlError('malformed_xml', 'GHX XML is incomplete.');
  }
  return root;
}

function directChild(parent: XmlNode, name: string): XmlNode | undefined {
  return parent.children.find((child) => child.name === name);
}

function chunk(parent: XmlNode, name: string): XmlNode | undefined {
  return directChild(parent, 'chunks')?.children.find(
    (child) => child.name === 'chunk' && child.attributes.name === name,
  );
}

function item(parent: XmlNode, name: string): XmlNode | undefined {
  return directChild(parent, 'items')?.children.find(
    (child) => child.name === 'item' && child.attributes.name === name,
  );
}

function itemText(parent: XmlNode, name: string): string | undefined {
  return item(parent, name)?.text.trim();
}

function numberText(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('GHX numeric values must be finite.');
  }
  return Object.is(value, -0) ? '0' : String(value);
}

function decimalPlaces(control: BrepGrasshopperNumberControlPlan): number {
  let result = 0;
  for (const value of [control.default, control.min, control.max, control.step]) {
    if (value == null) continue;
    const fixed = value.toFixed(12).replace(/0+$/, '').replace(/\.$/, '');
    const point = fixed.indexOf('.');
    result = Math.max(result, point < 0 ? 0 : fixed.length - point - 1);
  }
  return Math.min(result, 12);
}

function rectangleXml(control: BrepGrasshopperNumberControlPlan): string {
  const { x, y, width, height } = control.bounds;
  const pivotX = x + width / 2;
  const pivotY = y + height / 2;
  return `<chunk name="Attributes"><items count="2"><item name="Bounds" type_name="gh_drawing_rectanglef" type_code="35"><X>${numberText(x)}</X><Y>${numberText(y)}</Y><W>${numberText(width)}</W><H>${numberText(height)}</H></item><item name="Pivot" type_name="gh_drawing_pointf" type_code="31"><X>${numberText(pivotX)}</X><Y>${numberText(pivotY)}</Y></item></items></chunk>`;
}

function sliderXml(
  control: BrepGrasshopperNumberControlPlan,
  index: number,
): string {
  if (control.min == null || control.max == null || control.min >= control.max) {
    throw new Error(
      `Brepia GHX slider ${control.inputId} requires finite increasing bounds.`,
    );
  }
  return `<chunk name="Object" index="${index}"><items count="2"><item name="GUID" type_name="gh_guid" type_code="9">${BREP_GRASSHOPPER_GHX_NUMBER_SLIDER_GUID}</item><item name="Name" type_name="gh_string" type_code="10">Number Slider</item></items><chunks count="1"><chunk name="Container"><items count="6"><item name="Description" type_name="gh_string" type_code="10">Numeric slider for single values</item><item name="InstanceGuid" type_name="gh_guid" type_code="9">${control.instanceGuid}</item><item name="Name" type_name="gh_string" type_code="10">Number Slider</item><item name="NickName" type_name="gh_string" type_code="10">${escapeXml(control.label)}</item><item name="Optional" type_name="gh_bool" type_code="1">false</item><item name="SourceCount" type_name="gh_int32" type_code="3">0</item></items><chunks count="2">${rectangleXml(control)}<chunk name="Slider"><items count="7"><item name="Digits" type_name="gh_int32" type_code="3">${decimalPlaces(control)}</item><item name="GripDisplay" type_name="gh_int32" type_code="3">1</item><item name="Interval" type_name="gh_int32" type_code="3">1</item><item name="Max" type_name="gh_double" type_code="6">${numberText(control.max)}</item><item name="Min" type_name="gh_double" type_code="6">${numberText(control.min)}</item><item name="SnapCount" type_name="gh_int32" type_code="3">0</item><item name="Value" type_name="gh_double" type_code="6">${numberText(control.default)}</item></items></chunk></chunks></chunk></chunks></chunk>`;
}

function numberParameterXml(
  control: BrepGrasshopperNumberControlPlan,
  index: number,
): string {
  return `<chunk name="Object" index="${index}"><items count="2"><item name="GUID" type_name="gh_guid" type_code="9">${BREP_GRASSHOPPER_GHX_NUMBER_PARAMETER_GUID}</item><item name="Name" type_name="gh_string" type_code="10">Number</item></items><chunks count="1"><chunk name="Container"><items count="6"><item name="Description" type_name="gh_string" type_code="10">Contains a collection of floating point numbers</item><item name="InstanceGuid" type_name="gh_guid" type_code="9">${control.instanceGuid}</item><item name="Name" type_name="gh_string" type_code="10">Number</item><item name="NickName" type_name="gh_string" type_code="10">${escapeXml(control.label)}</item><item name="Optional" type_name="gh_bool" type_code="1">false</item><item name="SourceCount" type_name="gh_int32" type_code="3">0</item></items><chunks count="2">${rectangleXml(control)}<chunk name="PersistentData"><items count="1"><item name="Count" type_name="gh_int32" type_code="3">1</item></items><chunks count="1"><chunk name="Branch" index="0"><items count="2"><item name="Count" type_name="gh_int32" type_code="3">1</item><item name="Path" type_name="gh_string" type_code="10">{0}</item></items><chunks count="1"><chunk name="Item" index="0"><items count="1"><item name="number" type_name="gh_double" type_code="6">${numberText(control.default)}</item></items></chunk></chunks></chunk></chunks></chunk></chunks></chunk></chunks></chunk>`;
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

async function documentGuid(plan: BrepGrasshopperPackagePlan): Promise<string> {
  const encoder = new TextEncoder();
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(`${DOCUMENT_GUID_NAMESPACE}\0${plan.model.projectId}`),
    ),
  );
  const uuid = digest.slice(0, 16);
  uuid[6] = ((uuid[6] ?? 0) & 0x0f) | 0x80;
  uuid[8] = ((uuid[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(uuid);
}

/**
 * Phase 8E-A portability proof. This intentionally emits only Brepia numeric
 * controls. It is a real GHX document subset, but it is not yet the final
 * executable Brepia model export; the Rhino 8 Script bridge is added only
 * after its persistence shape is covered by an authoritative Rhino fixture.
 */
export async function compileBrepGrasshopperParameterShellGhx(
  value: unknown,
): Promise<string> {
  const plan = await createBrepGrasshopperPackagePlan(value);
  const id = await documentGuid(plan);
  const objects = plan.controls
    .map((control, index) =>
      control.presentation === 'slider'
        ? sliderXml(control, index)
        : numberParameterXml(control, index),
    )
    .join('');
  const name = `${plan.model.projectName}.ghx`;

  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?><Archive name="Root"><items count="1"><item name="ArchiveVersion" type_name="gh_version" type_code="80"><Major>0</Major><Minor>2</Minor><Revision>2</Revision></item></items><chunks count="1"><chunk name="Definition"><items count="1"><item name="plugin_version" type_name="gh_version" type_code="80"><Major>1</Major><Minor>0</Minor><Revision>7</Revision></item></items><chunks count="4"><chunk name="DocumentHeader"><items count="3"><item name="DocumentID" type_name="gh_guid" type_code="9">${id}</item><item name="Preview" type_name="gh_string" type_code="10">Shaded</item><item name="PreviewMeshType" type_name="gh_int32" type_code="3">1</item></items></chunk><chunk name="DefinitionProperties"><items count="2"><item name="Description" type_name="gh_string" type_code="10">Brepia Phase 8E parameter-shell portability proof. Executable model bridge not emitted yet.</item><item name="Name" type_name="gh_string" type_code="10">${escapeXml(name)}</item></items><chunks count="3"><chunk name="Revisions"><items count="1"><item name="RevisionCount" type_name="gh_int32" type_code="3">0</item></items></chunk><chunk name="Projection"><items count="2"><item name="Target" type_name="gh_drawing_point" type_code="30"><X>0</X><Y>0</Y></item><item name="Zoom" type_name="gh_single" type_code="5">1</item></items></chunk><chunk name="Views"><items count="1"><item name="ViewCount" type_name="gh_int32" type_code="3">0</item></items></chunk></chunks></chunk><chunk name="RcpLayout"><items count="1"><item name="GroupCount" type_name="gh_int32" type_code="3">0</item></items></chunk><chunk name="DefinitionObjects"><items count="1"><item name="ObjectCount" type_name="gh_int32" type_code="3">${plan.controls.length}</item></items><chunks count="${plan.controls.length}">${objects}</chunks></chunk></chunks></chunk></chunks></Archive>`;
}

function parseFinite(text: string | undefined): number | undefined {
  if (text == null || text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function diagnostic(
  diagnostics: BrepGrasshopperGhxDiagnostic[],
  code: string,
  message: string,
  path?: string,
) {
  diagnostics.push({
    code,
    severity: 'error',
    message,
    ...(path ? { path } : {}),
  });
}

function observeObject(
  objectNode: XmlNode,
  diagnostics: BrepGrasshopperGhxDiagnostic[],
  index: number,
): BrepGrasshopperGhxObservedParameter | undefined {
  const path = `DefinitionObjects/Object[${index}]`;
  const componentGuid = itemText(objectNode, 'GUID')?.toLowerCase();
  const container = chunk(objectNode, 'Container');
  const instanceGuid = container
    ? itemText(container, 'InstanceGuid')?.toLowerCase()
    : undefined;
  const label = container ? itemText(container, 'NickName') ?? '' : '';

  if (!componentGuid || !UUID.test(componentGuid)) {
    diagnostic(
      diagnostics,
      'invalid_component_guid',
      'Grasshopper object GUID is missing or invalid.',
      path,
    );
    return undefined;
  }
  if (!container || !instanceGuid || !UUID.test(instanceGuid)) {
    diagnostic(
      diagnostics,
      'invalid_instance_guid',
      'Grasshopper object InstanceGuid is missing or invalid.',
      path,
    );
    return undefined;
  }

  if (componentGuid === BREP_GRASSHOPPER_GHX_NUMBER_SLIDER_GUID) {
    const slider = chunk(container, 'Slider');
    const min = slider ? parseFinite(itemText(slider, 'Min')) : undefined;
    const max = slider ? parseFinite(itemText(slider, 'Max')) : undefined;
    const value = slider ? parseFinite(itemText(slider, 'Value')) : undefined;
    if (
      min == null ||
      max == null ||
      value == null ||
      min >= max ||
      value < min ||
      value > max
    ) {
      diagnostic(
        diagnostics,
        'invalid_slider_state',
        'Number Slider requires finite Min < Max and an in-range Value.',
        path,
      );
      return undefined;
    }
    return { instanceGuid, presentation: 'slider', label, value };
  }

  if (componentGuid === BREP_GRASSHOPPER_GHX_NUMBER_PARAMETER_GUID) {
    const persistent = chunk(container, 'PersistentData');
    const branch = persistent ? chunk(persistent, 'Branch') : undefined;
    const storedItem = branch ? chunk(branch, 'Item') : undefined;
    const value = storedItem
      ? parseFinite(itemText(storedItem, 'number'))
      : undefined;
    if (value == null) {
      diagnostic(
        diagnostics,
        'invalid_number_state',
        'Number parameter must contain one finite persistent numeric value.',
        path,
      );
      return undefined;
    }
    return { instanceGuid, presentation: 'number', label, value };
  }

  diagnostic(
    diagnostics,
    'unsupported_object',
    `Grasshopper object type ${componentGuid} is outside the current Brepia GHX subset.`,
    path,
  );
  return undefined;
}

function compareExpected(
  observed: BrepGrasshopperGhxObservedParameter[],
  plan: BrepGrasshopperPackagePlan,
  mode: 'generated' | 'returned',
  diagnostics: BrepGrasshopperGhxDiagnostic[],
) {
  const byGuid = new Map(observed.map((entry) => [entry.instanceGuid, entry]));
  const expectedGuids = new Set(
    plan.controls.map((control) => control.instanceGuid),
  );

  for (const control of plan.controls) {
    const actual = byGuid.get(control.instanceGuid);
    if (!actual) {
      diagnostic(
        diagnostics,
        'missing_parameter_control',
        `Expected Brepia parameter control ${control.inputId} is missing.`,
        `parameter:${control.inputId}`,
      );
      continue;
    }
    actual.inputId = control.inputId;
    if (actual.presentation !== control.presentation) {
      diagnostic(
        diagnostics,
        'parameter_presentation_changed',
        `Brepia parameter ${control.inputId} changed control representation.`,
        `parameter:${control.inputId}`,
      );
    }
    if (actual.label !== control.label) {
      diagnostic(
        diagnostics,
        'parameter_identity_changed',
        `Brepia parameter ${control.inputId} label/identity metadata changed.`,
        `parameter:${control.inputId}`,
      );
    }
    if (control.min != null && actual.value < control.min) {
      diagnostic(
        diagnostics,
        'parameter_out_of_bounds',
        `Brepia parameter ${control.inputId} is below its canonical minimum.`,
        `parameter:${control.inputId}`,
      );
    }
    if (control.max != null && actual.value > control.max) {
      diagnostic(
        diagnostics,
        'parameter_out_of_bounds',
        `Brepia parameter ${control.inputId} is above its canonical maximum.`,
        `parameter:${control.inputId}`,
      );
    }
    if (mode === 'generated' && actual.value !== control.default) {
      diagnostic(
        diagnostics,
        'generated_default_mismatch',
        `Generated GHX parameter ${control.inputId} does not match the canonical default.`,
        `parameter:${control.inputId}`,
      );
    }
  }

  for (const actual of observed) {
    if (!expectedGuids.has(actual.instanceGuid)) {
      diagnostic(
        diagnostics,
        'unexpected_parameter_control',
        `GHX contains an unexpected numeric control ${actual.instanceGuid}.`,
      );
    }
  }
}

export async function validateBrepGrasshopperParameterShellGhx(
  input: string,
  options: BrepGrasshopperGhxValidationOptions = {},
): Promise<BrepGrasshopperGhxValidationResult> {
  const diagnostics: BrepGrasshopperGhxDiagnostic[] = [];
  const summary: BrepGrasshopperGhxValidationResult['summary'] = {
    objectCount: 0,
    sliderCount: 0,
    numberCount: 0,
    parameters: [],
  };

  let root: XmlNode;
  try {
    root = parseSafeXml(input);
  } catch (error) {
    if (error instanceof GhxXmlError) {
      diagnostic(diagnostics, error.code, error.message);
    } else {
      diagnostic(
        diagnostics,
        'malformed_xml',
        'GHX could not be parsed safely.',
      );
    }
    return {
      accepted: false,
      valid: false,
      compatibility: 'unsupported',
      diagnostics,
      summary,
    };
  }

  if (root.name !== 'Archive' || root.attributes.name !== 'Root') {
    diagnostic(
      diagnostics,
      'invalid_root',
      'GHX root must be Archive name="Root".',
    );
  }
  const definition = chunk(root, 'Definition');
  if (!definition) {
    diagnostic(
      diagnostics,
      'missing_definition',
      'GHX Definition chunk is missing.',
    );
  }
  const definitionObjects = definition
    ? chunk(definition, 'DefinitionObjects')
    : undefined;
  if (!definitionObjects) {
    diagnostic(
      diagnostics,
      'missing_definition_objects',
      'GHX DefinitionObjects chunk is missing.',
    );
  }

  if (definitionObjects) {
    const declaredCount = Number.parseInt(
      itemText(definitionObjects, 'ObjectCount') ?? '',
      10,
    );
    const objects =
      directChild(definitionObjects, 'chunks')?.children.filter(
        (child) => child.name === 'chunk' && child.attributes.name === 'Object',
      ) ?? [];
    summary.objectCount = objects.length;
    if (!Number.isSafeInteger(declaredCount) || declaredCount !== objects.length) {
      diagnostic(
        diagnostics,
        'object_count_mismatch',
        'GHX ObjectCount does not match serialized Object chunks.',
      );
    }

    const instanceGuids = new Set<string>();
    for (const [index, objectNode] of objects.entries()) {
      const observed = observeObject(objectNode, diagnostics, index);
      if (!observed) continue;
      if (instanceGuids.has(observed.instanceGuid)) {
        diagnostic(
          diagnostics,
          'duplicate_instance_guid',
          `Duplicate Grasshopper InstanceGuid ${observed.instanceGuid}.`,
        );
        continue;
      }
      instanceGuids.add(observed.instanceGuid);
      summary.parameters.push(observed);
      if (observed.presentation === 'slider') summary.sliderCount += 1;
      else summary.numberCount += 1;
    }
  }

  if (options.expected != null) {
    try {
      const plan = await createBrepGrasshopperPackagePlan(options.expected);
      compareExpected(
        summary.parameters,
        plan,
        options.mode ?? 'generated',
        diagnostics,
      );
    } catch (error) {
      diagnostic(
        diagnostics,
        'invalid_expected_contract',
        `Expected Brepia contract/package source is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const valid = diagnostics.every((entry) => entry.severity !== 'error');
  const compatibility = valid ? 'supported-subset' : 'unsupported';
  return {
    accepted: valid && compatibility === 'supported-subset',
    valid,
    compatibility,
    diagnostics,
    summary,
  };
}
