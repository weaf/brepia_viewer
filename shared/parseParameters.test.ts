import { describe, expect, it } from 'vitest';
import parseParameters from './parseParameters.ts';

describe('parseParameters', () => {
  it('parses Customizer parameters declared after helper functions', () => {
    const source = `/* [Dimensions] */
width = 150; // [80:5:280]
function scaled_width() = width * 2;
/* [View] */
layout = "Print"; // [Assembled, Print]
profile_points = 96; // [64:16:128]
module body() { cube(width); }
`;

    const parameters = parseParameters(source);

    expect(parameters.map(({ name }) => name)).toEqual([
      'width',
      'layout',
      'profile_points',
    ]);
    expect(parameters.map(({ group }) => group)).toEqual([
      'Dimensions',
      'View',
      'View',
    ]);
  });
});
