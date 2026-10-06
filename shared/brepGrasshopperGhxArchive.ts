export const BREP_GRASSHOPPER_GHX_ARCHIVE_MAX_BYTES = 4 * 1024 * 1024;

const MAX_NODES = 32_768;
const MAX_DEPTH = 128;
const MAX_ATTRIBUTES = 64;
const MAX_TEXT_CHARS = BREP_GRASSHOPPER_GHX_ARCHIVE_MAX_BYTES;

export type BrepGrasshopperGhxArchiveNode = {
  name: string;
  attributes: Record<string, string>;
  children: BrepGrasshopperGhxArchiveNode[];
  text: string;
};

export class BrepGrasshopperGhxArchiveError extends Error {
  constructor(
    readonly code: 'too_large' | 'unsafe_xml' | 'malformed_xml',
    message: string,
  ) {
    super(message);
    this.name = 'BrepGrasshopperGhxArchiveError';
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function decodeEntity(entity: string): string {
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
        throw new BrepGrasshopperGhxArchiveError(
          'malformed_xml',
          `Invalid XML character entity ${entity}.`,
        );
      }
      return String.fromCodePoint(codePoint);
    }
  }
}

function decodeXml(value: string): string {
  const decoded = value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
    decodeEntity,
  );
  if (/&[^\s<]*;/.test(decoded)) {
    throw new BrepGrasshopperGhxArchiveError(
      'malformed_xml',
      'GHX contains an unsupported XML entity.',
    );
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
    if (!match?.[1] || match[3] == null) {
      throw new BrepGrasshopperGhxArchiveError(
        'malformed_xml',
        `Malformed XML attributes near ${rest.slice(0, 80)}.`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(attributes, match[1])) {
      throw new BrepGrasshopperGhxArchiveError(
        'malformed_xml',
        `Duplicate XML attribute ${match[1]}.`,
      );
    }
    attributes[match[1]] = decodeXml(match[3]);
    count += 1;
    if (count > MAX_ATTRIBUTES) {
      throw new BrepGrasshopperGhxArchiveError(
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

function top(
  stack: BrepGrasshopperGhxArchiveNode[],
): BrepGrasshopperGhxArchiveNode | undefined {
  return stack.length > 0 ? stack[stack.length - 1] : undefined;
}

export function parseBrepGrasshopperGhxArchive(
  input: string,
): BrepGrasshopperGhxArchiveNode {
  if (byteLength(input) > BREP_GRASSHOPPER_GHX_ARCHIVE_MAX_BYTES) {
    throw new BrepGrasshopperGhxArchiveError(
      'too_large',
      'GHX exceeds the maximum supported byte length.',
    );
  }
  if (input.includes('\0')) {
    throw new BrepGrasshopperGhxArchiveError(
      'unsafe_xml',
      'GHX contains a NUL byte.',
    );
  }

  let xml = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) {
    throw new BrepGrasshopperGhxArchiveError(
      'unsafe_xml',
      'DOCTYPE, ENTITY and CDATA declarations are not allowed in Brepia GHX.',
    );
  }
  xml = xml.trim();
  if (xml.startsWith('<?xml')) {
    const end = xml.indexOf('?>');
    if (end < 0) {
      throw new BrepGrasshopperGhxArchiveError(
        'malformed_xml',
        'Unterminated XML declaration.',
      );
    }
    xml = xml.slice(end + 2).trimStart();
  }
  if (xml.includes('<?')) {
    throw new BrepGrasshopperGhxArchiveError(
      'unsafe_xml',
      'XML processing instructions are not allowed in Brepia GHX.',
    );
  }

  const stack: BrepGrasshopperGhxArchiveNode[] = [];
  let root: BrepGrasshopperGhxArchiveNode | undefined;
  let cursor = 0;
  let nodeCount = 0;
  let textChars = 0;

  while (cursor < xml.length) {
    const open = xml.indexOf('<', cursor);
    if (open < 0) {
      const tail = xml.slice(cursor);
      if (tail.trim().length > 0) {
        const current = top(stack);
        if (!current) {
          throw new BrepGrasshopperGhxArchiveError(
            'malformed_xml',
            'Text exists outside the root XML element.',
          );
        }
        const decoded = decodeXml(tail);
        current.text += decoded;
        textChars += decoded.length;
      }
      break;
    }

    if (open > cursor) {
      const rawText = xml.slice(cursor, open);
      const current = top(stack);
      if (!current) {
        if (rawText.trim().length > 0) {
          throw new BrepGrasshopperGhxArchiveError(
            'malformed_xml',
            'Text exists outside the root XML element.',
          );
        }
      } else {
        const decoded = decodeXml(rawText);
        current.text += decoded;
        textChars += decoded.length;
      }
      if (textChars > MAX_TEXT_CHARS) {
        throw new BrepGrasshopperGhxArchiveError(
          'malformed_xml',
          'GHX XML text content exceeds the supported limit.',
        );
      }
    }

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end < 0) {
        throw new BrepGrasshopperGhxArchiveError(
          'malformed_xml',
          'Unterminated XML comment.',
        );
      }
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith('<!', open)) {
      throw new BrepGrasshopperGhxArchiveError(
        'unsafe_xml',
        'Unsupported XML declaration in GHX.',
      );
    }

    const close = findTagEnd(xml, open + 1);
    if (close < 0) {
      throw new BrepGrasshopperGhxArchiveError(
        'malformed_xml',
        'Unterminated XML element.',
      );
    }
    let tag = xml.slice(open + 1, close).trim();
    cursor = close + 1;

    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const current = stack.pop();
      if (
        !/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name) ||
        !current ||
        current.name !== name
      ) {
        throw new BrepGrasshopperGhxArchiveError(
          'malformed_xml',
          `Mismatched closing XML element ${name}.`,
        );
      }
      continue;
    }

    const selfClosing = tag.endsWith('/');
    if (selfClosing) tag = tag.slice(0, -1).trimEnd();
    const match = /^([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s+([\s\S]*))?$/.exec(tag);
    if (!match?.[1]) {
      throw new BrepGrasshopperGhxArchiveError(
        'malformed_xml',
        'Invalid XML element name.',
      );
    }
    const node: BrepGrasshopperGhxArchiveNode = {
      name: match[1],
      attributes: parseAttributes(match[2] ?? ''),
      children: [],
      text: '',
    };
    nodeCount += 1;
    if (nodeCount > MAX_NODES) {
      throw new BrepGrasshopperGhxArchiveError(
        'malformed_xml',
        'GHX contains too many XML nodes.',
      );
    }

    const parent = top(stack);
    if (parent) parent.children.push(node);
    else if (root) {
      throw new BrepGrasshopperGhxArchiveError(
        'malformed_xml',
        'GHX must contain exactly one XML root element.',
      );
    } else root = node;

    if (!selfClosing) {
      stack.push(node);
      if (stack.length > MAX_DEPTH) {
        throw new BrepGrasshopperGhxArchiveError(
          'malformed_xml',
          'GHX XML nesting exceeds the supported depth.',
        );
      }
    }
  }

  if (!root || stack.length !== 0) {
    throw new BrepGrasshopperGhxArchiveError(
      'malformed_xml',
      'GHX XML is incomplete.',
    );
  }
  return root;
}

export function ghxDirectChild(
  parent: BrepGrasshopperGhxArchiveNode,
  name: string,
): BrepGrasshopperGhxArchiveNode | undefined {
  return parent.children.find((child) => child.name === name);
}

export function ghxChunk(
  parent: BrepGrasshopperGhxArchiveNode,
  name: string,
  index?: string,
): BrepGrasshopperGhxArchiveNode | undefined {
  return ghxDirectChild(parent, 'chunks')?.children.find(
    (child) =>
      child.name === 'chunk' &&
      child.attributes.name === name &&
      (index == null || child.attributes.index === index),
  );
}

export function ghxChunks(
  parent: BrepGrasshopperGhxArchiveNode,
  name: string,
): BrepGrasshopperGhxArchiveNode[] {
  return (
    ghxDirectChild(parent, 'chunks')?.children.filter(
      (child) => child.name === 'chunk' && child.attributes.name === name,
    ) ?? []
  );
}

export function ghxItem(
  parent: BrepGrasshopperGhxArchiveNode,
  name: string,
  index?: string,
): BrepGrasshopperGhxArchiveNode | undefined {
  return ghxDirectChild(parent, 'items')?.children.find(
    (child) =>
      child.name === 'item' &&
      child.attributes.name === name &&
      (index == null || child.attributes.index === index),
  );
}

export function ghxItemText(
  parent: BrepGrasshopperGhxArchiveNode,
  name: string,
  index?: string,
): string | undefined {
  return ghxItem(parent, name, index)?.text.trim();
}
