import type {
  Parameter,
  ParameterOption,
  ParameterRange,
  ParameterType,
} from './types.ts';

/**
 * Extract editable parameters from a piece of OpenSCAD source.
 *
 * This is the single source of truth for "what does this CAD model expose
 * as a slider/input?" — the model only emits the OpenSCAD `code`, and we
 * derive parameter metadata client-side from the variable declarations at
 * the top of the file. That removes the divergent-UI problem we had when
 * different models (Claude vs Gemini) produced different shaped
 * parameter arrays for the same code: now the same source always renders
 * the same `<ParameterSection>`, regardless of provider.
 *
 * The format the model is told to emit is the Customizer-style annotation
 * vocabulary:
 *
 *     // Description of the parameter
 *     name = 10; // [1:50]              ← min:max
 *     name = 10; // [1:1:50]            ← min:step:max
 *     name = "red"; // [red, green, blue]  ← enum options
 *     name = "label"; // 20             ← maxLength for strings, step for numbers
 *     \/* [Group Name] *\/              ← starts a new group section
 *
 * Customizer declarations are collected across the entire source file, so
 * helper functions placed between parameter groups do not hide later controls.
 * Derived expressions and declarations without literal values are ignored.
 *
 * TODO: Use AST parser instead of regex.  Regex breaks on multi-line
 * expressions, nested arrays, and any clever OpenSCAD trick. An AST
 * parser would handle that gracefully — for now, the regex covers the
 * shapes the model actually emits.
 */
export default function parseParameters(script: string): Parameter[] {
  // Scan the entire file: OpenSCAD files may interleave helper functions
  // with additional Customizer parameter groups.
  const parameters: Record<string, Parameter> = {};
  const parameterRegex =
    /^([a-z0-9A-Z_$]+)\s*=\s*([^;]+);[\t\f\cK ]*(\/\/[^\n]*)?/gm;
  const groupRegex = /^\/\*\s*\[([^\]]+)\]\s*\*\//gm;

  // Build a list of source ranges keyed by group, so a `/* [Group] */`
  // marker influences only the variables declared below it. We track each
  // group's start offset directly off the regex match position — using the
  // marker text as an id and then `indexOf`-ing it would collide whenever
  // the same group label appears twice in the source.
  const groupSections: { startIndex: number; group: string; code: string }[] = [
    { startIndex: 0, group: '', code: script },
  ];
  let tmpGroup: RegExpExecArray | null;
  while ((tmpGroup = groupRegex.exec(script))) {
    groupSections.push({
      startIndex: tmpGroup.index,
      group: tmpGroup[1].trim(),
      code: '',
    });
  }
  groupSections.forEach((group, index) => {
    const nextGroup = groupSections[index + 1];
    const endIndex = nextGroup ? nextGroup.startIndex : script.length;
    group.code = script.substring(group.startIndex, endIndex);
  });

  groupSections.forEach((groupSection) => {
    let match;
    while ((match = parameterRegex.exec(groupSection.code)) !== null) {
      const name = match[1];
      const value = match[2];
      let typeAndValue:
        { value: Parameter['value']; type: Parameter['type'] } | undefined;
      try {
        typeAndValue = convertType(value);
      } catch {
        continue;
      }
      if (!typeAndValue) continue;

      let description: Parameter['description'] = undefined;
      let options: ParameterOption[] = [];
      let range: ParameterRange = {};

      // Skip values that reference another variable or span lines —
      // they're computed expressions, not constants. Once we hit one,
      // bail out of THIS group section because anything further is
      // probably derived from it.
      if (
        value !== 'true' &&
        value !== 'false' &&
        (value.match(/^[a-zA-Z_]/) || value.split('\n').length > 1)
      ) {
        continue;
      }

      // Parse only the bracketed Customizer hint. Descriptive suffixes may
      // contain commas; they are not additional enum choices.
      if (match[3]) {
        const hint = parseCustomizerHint(match[3], typeAndValue.type);
        options = hint.options;
        range = hint.range;
      }

      // The description is the last `// ...` comment on the line
      // IMMEDIATELY above the variable declaration.
      let above = script.split(
        new RegExp(`^${escapeRegExp(match[0])}`, 'gm'),
      )[0];
      if (above.endsWith('\n')) above = above.slice(0, -1);
      const splitted = above.split('\n').reverse();
      const lastLineBeforeDefinition = splitted[0];
      if (lastLineBeforeDefinition.trim().startsWith('//')) {
        description = lastLineBeforeDefinition.replace(/^\/\/\/*\s*/, '');
        if (description.length === 0) description = undefined;
      }

      // Snake_case → Title Case for the visible label. `$fn` gets a
      // special name because OpenSCAD users recognise it as resolution.
      // Filtering empty tokens guards against names with leading, trailing,
      // or repeated underscores (e.g. `__width`) producing `word[0]` on an
      // empty string and crashing.
      let displayName = name
        .replace(/_/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(' ');
      if (name === '$fn') displayName = 'Resolution';

      // Flatten `name = [a, b, c]` (number[]) into N scalar sliders
      // `name[0]`, `name[1]`, ... — far easier to manipulate via the
      // sidebar than a single multi-value field.
      if (
        typeAndValue.type === 'number[]' &&
        Array.isArray(typeAndValue.value)
      ) {
        const labels = numberArrayLabels(name, typeAndValue.value.length);
        typeAndValue.value.forEach((itemValue, index) => {
          parameters[`${name}[${index}]`] = {
            description,
            group: groupSection.group,
            name: `${name}[${index}]`,
            displayName: displayNameForArrayItem(displayName, labels[index]),
            defaultValue: itemValue,
            range,
            options,
            value: itemValue,
            type: 'number',
          };
        });
        continue;
      }

      parameters[name] = {
        description,
        group: groupSection.group,
        name,
        displayName,
        defaultValue: typeAndValue.value,
        range,
        options,
        ...typeAndValue,
      };
    }
  });

  return Object.values(parameters);
}

function numberArrayLabels(name: string, length: number) {
  if (length === 2) return ['X', 'Y'];
  if (length !== 3) return Array.from({ length }, (_, i) => `${i + 1}`);
  const lowerName = name.toLowerCase();
  if (
    lowerName.includes('size') ||
    lowerName.includes('dimension') ||
    lowerName.includes('body') ||
    lowerName.includes('torso') ||
    lowerName.includes('head') ||
    lowerName.includes('foot') ||
    lowerName.includes('base')
  ) {
    return ['Width', 'Depth', 'Height'];
  }
  return ['X', 'Y', 'Z'];
}

function displayNameForArrayItem(displayName: string, label: string) {
  if (['Width', 'Depth', 'Height'].includes(label)) {
    return displayName.replace(/\s+Size$/i, '') + ` ${label}`;
  }
  return `${displayName} ${label}`;
}

function convertType(rawValue: string): {
  value: Parameter['value'];
  type: ParameterType;
} {
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    return { value: parseFloat(rawValue), type: 'number' };
  }
  if (rawValue === 'true' || rawValue === 'false') {
    return { value: rawValue === 'true', type: 'boolean' };
  }
  if (/^".*"$/.test(rawValue)) {
    return { value: rawValue.replace(/^"(.*)"$/, '$1'), type: 'string' };
  }
  if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
    const arrayValue = rawValue
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim());
    if (
      arrayValue.length > 0 &&
      arrayValue.every((item) => /^-?\d+(\.\d+)?$/.test(item))
    ) {
      return {
        value: arrayValue.map((item) => parseFloat(item)),
        type: 'number[]',
      };
    }
    if (
      arrayValue.length > 0 &&
      arrayValue.every((item) => /^".*"$/.test(item))
    ) {
      return {
        value: arrayValue.map((item) => item.slice(1, -1)),
        type: 'string[]',
      };
    }
    if (
      arrayValue.length > 0 &&
      arrayValue.every((item) => item === 'true' || item === 'false')
    ) {
      return {
        value: arrayValue.map((item) => item === 'true'),
        type: 'boolean[]',
      };
    }
    throw new Error(`Invalid array value: ${rawValue}`);
  }
  throw new Error(`Invalid value: ${rawValue}`);
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FINITE_NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function finiteNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!FINITE_NUMERIC_LITERAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Only the first [bracketed] section is Customizer metadata.
 * Human-readable descriptions after its closing bracket are never parsed
 * as enum members or numeric slider bounds.
 */
function parseCustomizerHint(
  comment: string,
  type: ParameterType | undefined,
): { range: ParameterRange; options: ParameterOption[] } {
  const empty = { range: {} as ParameterRange, options: [] as ParameterOption[] };
  const raw = comment.replace(/^\/\/\s*/, '').trim();
  const bracket = /^\[([^\]]+)\](?:\s+.*)?$/.exec(raw);
  if (bracket) {
    const body = bracket[1].trim();
    if (body.includes(',')) {
      if (type !== 'string' && type !== 'number') return empty;
      const values = body.split(',').map(token => {
        const separator = token.indexOf(':');
        const rawValue = (separator < 0 ? token : token.slice(0, separator)).trim();
        const label = separator < 0 ? undefined : token.slice(separator + 1).trim();
        const parsed = type === 'number' ? finiteNumber(rawValue) : rawValue;
        if (parsed === null || parsed === '') return null;
        return { value: parsed, ...(label ? { label } : {}) } as ParameterOption;
      });
      return values.every((item): item is ParameterOption => item !== null)
        ? { range: {}, options: values }
        : empty;
    }

    if (type === 'number') {
      const tokens = body.split(':').map(token => token.trim());
      if (tokens.length !== 2 && tokens.length !== 3) return empty;
      const numbers = tokens.map(finiteNumber);
      if (numbers.some(value => value === null)) return empty;
      const [min, middle, last] = numbers as number[];
      const max = tokens.length === 3 ? last : middle;
      const step = tokens.length === 3 ? middle : undefined;
      if (!Number.isFinite(max) || min >= max ||
          (step !== undefined && step <= 0)) return empty;
      return {
        range: { min, max, ...(step !== undefined ? { step } : {}) },
        options: [],
      };
    }
    return empty;
  }

  const bare = finiteNumber(raw);
  if (bare === null || bare <= 0) return empty;
  if (type === 'string') return { range: { max: bare }, options: [] };
  if (type === 'number') return { range: { step: bare }, options: [] };
  return empty;
}
