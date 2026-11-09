import { describe, expect, it } from 'vitest';
import { findOpenScadProjectDefinition as locate } from './openScadDefinitionNavigation';

const project = {
  files: [
    { path: 'main.scad', content: 'use <parts.scad>;\nleg(10);\nmodule local_leg(n) { cube([n, 2, 2]); }\nlocal_leg(5);' },
    { path: 'parts.scad', content: '// module fake() {}\n/* function fake_two() = 2; */\nmodule leg(length) { translate([0, 0, length]) cube(4); }' },
  ],
};

describe('project-local OpenSCAD go-to-definition', () => {
  it('finds modules in the current file', () => {
    const source = project.files[0].content;
    const cursor = source.lastIndexOf('local_leg') + 3;
    const target = locate(project, 'main.scad', source, cursor);
    expect(target).toMatchObject({ path: 'main.scad', kind: 'module', name: 'local_leg' });
    expect(source.slice(target!.offset).startsWith('local_leg(')).toBe(true);
  });

  it('finds project module definitions in another file', () => {
    const source = project.files[0].content;
    const target = locate(project, 'main.scad', source, source.indexOf('leg(10)') + 1);
    expect(target).toMatchObject({ path: 'parts.scad', name: 'leg', kind: 'module' });
    expect(project.files[1].content.slice(target!.offset).startsWith('leg(')).toBe(true);
  });

  it('ignores definitions and references hidden in comments or strings', () => {
    const source = 'fake();\n// fake_two();\ntext("leg()");';
    expect(locate(project, 'main.scad', source, source.indexOf('fake(') + 1)).toBeNull();
    expect(locate(project, 'main.scad', source, source.indexOf('fake_two(') + 2)).toBeNull();
    expect(locate(project, 'main.scad', source, source.indexOf('leg()') + 1)).toBeNull();
  });

  it('returns null when only a built-in or external module is referenced', () => {
    expect(locate(project, 'main.scad', 'cube(10);', 2)).toBeNull();
    expect(locate(undefined, 'main.scad', 'leg(10);', 2)).toBeNull();
  });

  it('prefers the current file when a symbol is declared more than once', () => {
    const other = { files: [
      { path: 'one.scad', content: 'module same(){} same();' },
      { path: 'two.scad', content: 'module same(){} same();' },
    ] };
    const target = locate(other, 'two.scad', other.files[1].content, other.files[1].content.lastIndexOf('same()') + 2);
    expect(target?.path).toBe('two.scad');
  });

  it('uses draft content supplied by the project editor', () => {
    const draft = { files: [{ path: 'main.scad', content: 'module new_part(x) {} new_part(3);' }] };
    const target = locate(draft, 'main.scad', draft.files[0].content, draft.files[0].content.lastIndexOf('new_part') + 3);
    expect(target?.name).toBe('new_part');
  });
});

describe('scoped variables, parameters, let/for and large model navigation', () => {
  const resolve = (source: string, marker: string, occurrence = 0) => {
    const offset = occurrence ? source.lastIndexOf(marker) : source.indexOf(marker);
    expect(offset).toBeGreaterThanOrEqual(0);
    return locate({ files: [{ path: 'main.scad', content: source }] },
      'main.scad', source, offset + 1);
  };
  it('navigates to a top-level variable referenced in geometry', () => {
    const src = 'body_diameter = 50;\nmodule body() { sphere(d=body_diameter); }';
    const target = resolve(src, 'body_diameter', 1);
    expect(target).toMatchObject({ kind: 'variable', offset: 0, name: 'body_diameter' });
  });
  it('navigates to a module parameter including one without a default', () => {
    const src = 'module link(length, width=4) { cube([length, width, 2]); }';
    expect(resolve(src, 'length', 1)).toMatchObject({kind:'parameter', offset:src.indexOf('length')});
    expect(resolve(src, 'width', 1)).toMatchObject({kind:'parameter', offset:src.indexOf('width')});
  });
  it('navigates to function parameters and local variables', () => {
    const src='function sum(a,b=3) = a + b;\nmodule part(v) { local_size = v+1; cube(local_size); }';
    expect(resolve(src,'a +')).toMatchObject({kind:'parameter',name:'a'});
    expect(resolve(src,'b;')).toMatchObject({kind:'parameter',name:'b'});
    const variable=resolve(src,'local_size',1);
    expect(variable).toMatchObject({kind:'variable', offset:src.indexOf('local_size')});
    const param=resolve(src,'v+1');
    expect(param).toMatchObject({kind:'parameter', name:'v'});
  });
  it('keeps nested local variables separate from identically named global ones', () => {
    const src='length=10; module outer() { length=3; cube(length); } sphere(length);';
    const nested=resolve(src,'length);');
    expect(nested?.offset).toBe(src.indexOf('length=3'));
    const global=resolve(src,'length);',1);
    expect(global?.offset).toBe(0);
  });
  it('navigates to let bindings but never leaks them outside the expression', () => {
    const src='function f(a) = let(inner=a+1) inner*2;\ncube(inner);';
    expect(resolve(src,'inner*2')).toMatchObject({kind:'variable',offset:src.indexOf('inner=')});
    expect(resolve(src,'inner);')).toBeNull();
  });
  it('supports for variables without leaking beyond the body', () => {
    const src='for (index=[0:2]) { translate([index,0,0]) cube(1); }\ncube(index);';
    expect(resolve(src,'index,0')).toMatchObject({kind:'variable',offset:src.indexOf('index=')});
    expect(resolve(src,'index);')).toBeNull();
  });
  it('handles special variables such as $fn', () => {
    const src='$fn=64;\nmodule part() { cylinder(h=5, $fn=$fn); }';
    expect(resolve(src,'$fn);')).toMatchObject({kind:'variable',name:'$fn',offset:0});
  });
  it('does not treat named call arguments as variable definitions', () => {
    const src='cube(size=10); echo(size);';
    expect(resolve(src,'size);')).toBeNull();
  });
  it('prefers module/function calls over colliding variable names', () => {
    const src='function radius(x)=x; radius=50; echo(radius); echo(radius(2));';
    expect(resolve(src,'radius);')).toMatchObject({kind:'variable',offset:src.indexOf('radius=50')});
    expect(resolve(src,'radius(2)')).toMatchObject({kind:'function',offset:src.indexOf('radius(x)')});
  });
  it('uses project globals but does not resolve foreign file locals', () => {
    const source='cube(global_size); cube(private_size);';
    const p={files:[{path:'main.scad',content:source},{path:'defs.scad',content:'global_size=8; module x(){ private_size=4; cube(private_size); }'}]};
    expect(locate(p,'main.scad',source,source.indexOf('global_size')+1))
      .toMatchObject({path:'defs.scad',kind:'variable',offset:0});
    expect(locate(p,'main.scad',source,source.indexOf('private_size')+1)).toBeNull();
  });
});

\n