export type OpenScadSnippetCategory = "Noteringar"
  | "Shapes"
  | "Transform"
  | "Booleans"
  | "2D & extrude"
  | "Modifiers"
  | "Programming"
  | "Parameters"
  | "Files"
  | "Templates";

export type OpenScadSnippetIcon = "arrow-right"
  | "move-horizontal"
  | "ruler"
  | "box"
  | "circle"
  | "cylinder"
  | "square"
  | "triangle"
  | "type"
  | "move"
  | "rotate"
  | "scale"
  | "mirror"
  | "layers"
  | "minus"
  | "scan"
  | "palette"
  | "eye"
  | "eye-off"
  | "code"
  | "repeat"
  | "branch"
  | "settings"
  | "file"
  | "grid";

export interface OpenScadSnippet {
  id: string;
  label: string;
  category: OpenScadSnippetCategory;
  icon: OpenScadSnippetIcon;
  description: string;
  insert?: string;
  wrap?: string;
  body?: string;
}

// Additions are data only: the React toolbar supplies icons and presentation.
// Keep these examples syntactically valid and safe for offline OpenSCAD use.
export const openScadSnippets: readonly OpenScadSnippet[] = [
  {
    "id": "cube",
    "label": "Cube",
    "category": "Shapes",
    "icon": "box",
    "description": "3D rectangular solid",
    "insert": "cube([10, 10, 10], center = true);"
  },
  {
    "id": "sphere",
    "label": "Sphere",
    "category": "Shapes",
    "icon": "circle",
    "description": "Sphere with radius",
    "insert": "sphere(r = 10, $fn = 48);"
  },
  {
    "id": "cylinder",
    "label": "Cylinder",
    "category": "Shapes",
    "icon": "cylinder",
    "description": "Circular cylinder",
    "insert": "cylinder(h = 20, r = 5, center = true);"
  },
  {
    "id": "circle",
    "label": "Circle",
    "category": "Shapes",
    "icon": "circle",
    "description": "2D circle",
    "insert": "circle(r = 10);"
  },
  {
    "id": "square",
    "label": "Square",
    "category": "Shapes",
    "icon": "square",
    "description": "2D rectangle",
    "insert": "square([20, 10], center = true);"
  },
  {
    "id": "polygon",
    "label": "Polygon",
    "category": "Shapes",
    "icon": "triangle",
    "description": "2D polygon points",
    "insert": "polygon(points = [[0,0], [20,0], [10,15]]);"
  },
  {
    "id": "text",
    "label": "Text",
    "category": "Noteringar",
    "icon": "type",
    "description": "Extruded 3D text (edit height for thickness)",
    "insert": "linear_extrude(height = 3) {\n    text(\"Hello\", size = 8, halign = \"center\");\n}"
  },
  {
    "id": "arrow",
    "label": "Arrow",
    "category": "Noteringar",
    "icon": "arrow-right",
    "description": "Editable 3D arrow with length and thickness",
    "insert": "arrow_length = 30;\narrow_width = 4;\narrow_head = 8;\narrow_height = 2;\nlinear_extrude(height = arrow_height)\n    polygon(points = [\n        [0, -arrow_width/2],\n        [arrow_length-arrow_head, -arrow_width/2],\n        [arrow_length-arrow_head, -arrow_width],\n        [arrow_length, 0],\n        [arrow_length-arrow_head, arrow_width],\n        [arrow_length-arrow_head, arrow_width/2],\n        [0, arrow_width/2]\n    ]);"
  },
  {
    "id": "double-arrow",
    "label": "Double arrow",
    "category": "Noteringar",
    "icon": "move-horizontal",
    "description": "Editable double-headed 3D arrow",
    "insert": "double_arrow_length = 40;\ndouble_arrow_width = 2;\ndouble_arrow_head = 7;\ndouble_arrow_height = 2;\nlinear_extrude(height = double_arrow_height)\n    polygon(points = [\n        [0, 0],\n        [double_arrow_head, -4],\n        [double_arrow_head, -double_arrow_width/2],\n        [double_arrow_length-double_arrow_head, -double_arrow_width/2],\n        [double_arrow_length-double_arrow_head, -4],\n        [double_arrow_length, 0],\n        [double_arrow_length-double_arrow_head, 4],\n        [double_arrow_length-double_arrow_head, double_arrow_width/2],\n        [double_arrow_head, double_arrow_width/2],\n        [double_arrow_head, 4]\n    ]);"
  },
  {
    "id": "dimension",
    "label": "Dimension",
    "category": "Noteringar",
    "icon": "ruler",
    "description": "Editable 3D dimension lines, arrows and label; not automatic measurement",
    "insert": "dimension_length = 30; // mm, set to the real dimension\ndimension_offset = 12;\ndimension_line = 0.8;\ndimension_arrow = 4;\ndimension_height = 1.5;\nlinear_extrude(height = dimension_height) {\n    translate([0, dimension_offset-dimension_line/2])\n        square([dimension_length, dimension_line]);\n    translate([-dimension_line/2, -2])\n        square([dimension_line, dimension_offset+4]);\n    translate([dimension_length-dimension_line/2, -2])\n        square([dimension_line, dimension_offset+4]);\n    polygon(points = [[0, dimension_offset],\n        [dimension_arrow, dimension_offset-1.6],\n        [dimension_arrow, dimension_offset+1.6]]);\n    polygon(points = [[dimension_length, dimension_offset],\n        [dimension_length-dimension_arrow, dimension_offset-1.6],\n        [dimension_length-dimension_arrow, dimension_offset+1.6]]);\n    translate([dimension_length/2, dimension_offset+3])\n        text(str(dimension_length, \" mm\"), size=3, halign=\"center\");\n}"
  },
  {
    "id": "polyhedron",
    "label": "Polyhedron",
    "category": "Shapes",
    "icon": "box",
    "description": "Triangle-faced tetrahedron",
    "insert": "polyhedron(points=[[0,0,0],[10,0,0],[0,10,0],[0,0,10]], faces=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]]);"
  },
  {
    "id": "translate",
    "label": "Translate",
    "category": "Transform",
    "icon": "move",
    "description": "Move geometry by vector",
    "wrap": "translate([10, 0, 0])",
    "body": "cube([10, 10, 10]);"
  },
  {
    "id": "rotate",
    "label": "Rotate",
    "category": "Transform",
    "icon": "rotate",
    "description": "Rotate geometry by degrees",
    "wrap": "rotate([0, 0, 45])",
    "body": "cube([10, 10, 10]);"
  },
  {
    "id": "scale",
    "label": "Scale",
    "category": "Transform",
    "icon": "scale",
    "description": "Scale along X Y Z",
    "wrap": "scale([1, 1, 1])",
    "body": "cube([10, 10, 10]);"
  },
  {
    "id": "mirror",
    "label": "Mirror",
    "category": "Transform",
    "icon": "mirror",
    "description": "Mirror across a plane",
    "wrap": "mirror([1, 0, 0])",
    "body": "cube([10, 10, 10]);"
  },
  {
    "id": "resize",
    "label": "Resize",
    "category": "Transform",
    "icon": "scale",
    "description": "Resize to exact dimensions",
    "wrap": "resize([20, 15, 10])",
    "body": "cube([10, 10, 10]);"
  },
  {
    "id": "multmatrix",
    "label": "Multmatrix",
    "category": "Transform",
    "icon": "move",
    "description": "Apply an affine transformation matrix",
    "wrap": "multmatrix([[1,0,0,10],[0,1,0,0],[0,0,1,0],[0,0,0,1]])",
    "body": "cube(10);"
  },
  {
    "id": "union",
    "label": "Union",
    "category": "Booleans",
    "icon": "layers",
    "description": "Combine shapes",
    "wrap": "union()",
    "body": "cube(10);\nsphere(5);"
  },
  {
    "id": "difference",
    "label": "Difference",
    "category": "Booleans",
    "icon": "minus",
    "description": "Subtract second solid",
    "wrap": "difference()",
    "body": "cube(20);\nsphere(9);"
  },
  {
    "id": "intersection",
    "label": "Intersection",
    "category": "Booleans",
    "icon": "scan",
    "description": "Keep overlapping volume",
    "wrap": "intersection()",
    "body": "cube(20);\nsphere(13);"
  },
  {
    "id": "hull",
    "label": "Hull",
    "category": "Booleans",
    "icon": "layers",
    "description": "Convex hull around shapes",
    "wrap": "hull()",
    "body": "translate([-8,0,0]) sphere(5);\ntranslate([8,0,0]) sphere(5);"
  },
  {
    "id": "minkowski",
    "label": "Minkowski",
    "category": "Booleans",
    "icon": "layers",
    "description": "Add geometry by Minkowski sum",
    "wrap": "minkowski()",
    "body": "cube([20,10,5], center=true);\nsphere(r=2, $fn=16);"
  },
  {
    "id": "linear-extrude",
    "label": "Linear extrude",
    "category": "2D & extrude",
    "icon": "layers",
    "description": "Extrude 2D geometry along Z",
    "wrap": "linear_extrude(height = 10)",
    "body": "circle(r = 5);"
  },
  {
    "id": "rotate-extrude",
    "label": "Rotate extrude",
    "category": "2D & extrude",
    "icon": "rotate",
    "description": "Revolve 2D outline",
    "wrap": "rotate_extrude(angle = 360)",
    "body": "translate([10, 0, 0]) circle(r = 2);"
  },
  {
    "id": "offset",
    "label": "Offset",
    "category": "2D & extrude",
    "icon": "scale",
    "description": "Expand or contract 2D geometry",
    "wrap": "offset(r = 2)",
    "body": "square([12, 8], center = true);"
  },
  {
    "id": "projection",
    "label": "Projection",
    "category": "2D & extrude",
    "icon": "scan",
    "description": "Flatten 3D geometry onto 2D plane",
    "wrap": "projection(cut = false)",
    "body": "sphere(10);"
  },
  {
    "id": "render",
    "label": "Render",
    "category": "2D & extrude",
    "icon": "box",
    "description": "Force CSG render for a subtree",
    "wrap": "render(convexity = 10)",
    "body": "cube(10);"
  },
  {
    "id": "offset-chamfer",
    "label": "2D chamfer",
    "category": "2D & extrude",
    "icon": "triangle",
    "description": "Chamfer a 2D outline",
    "insert": "offset(delta = 2, chamfer = true) square([20, 10], center = true);"
  },
  {
    "id": "color",
    "label": "Color",
    "category": "Modifiers",
    "icon": "palette",
    "description": "Apply material preview color",
    "wrap": "color(\"steelblue\")",
    "body": "cube(10);"
  },
  {
    "id": "highlight",
    "label": "Highlight (#)",
    "category": "Modifiers",
    "icon": "eye",
    "description": "Highlight a geometry in preview",
    "insert": "#cube(10);"
  },
  {
    "id": "background",
    "label": "Background (%)",
    "category": "Modifiers",
    "icon": "eye",
    "description": "Show ghost geometry in preview",
    "insert": "%cube(10);"
  },
  {
    "id": "disable",
    "label": "Disable (*)",
    "category": "Modifiers",
    "icon": "eye-off",
    "description": "Disable geometry without deleting it",
    "insert": "*cube(10);"
  },
  {
    "id": "root",
    "label": "Root (!)",
    "category": "Modifiers",
    "icon": "scan",
    "description": "Show only this subtree during preview",
    "insert": "!cube(10);"
  },
  {
    "id": "module",
    "label": "Module",
    "category": "Programming",
    "icon": "code",
    "description": "Declare reusable geometry",
    "wrap": "module my_part(size = 10)",
    "body": "cube(size);"
  },
  {
    "id": "function",
    "label": "Function",
    "category": "Programming",
    "icon": "code",
    "description": "Declare reusable expression",
    "insert": "function double_value(x) = x * 2;"
  },
  {
    "id": "for",
    "label": "For loop",
    "category": "Programming",
    "icon": "repeat",
    "description": "Repeat geometry over a range",
    "wrap": "for (i = [0:4])",
    "body": "translate([i * 10, 0, 0]) sphere(r = 3);"
  },
  {
    "id": "if-else",
    "label": "If / else",
    "category": "Programming",
    "icon": "branch",
    "description": "Conditional geometry",
    "insert": "if (true) {\n    cube(10);\n} else {\n    sphere(5);\n}"
  },
  {
    "id": "let",
    "label": "Let",
    "category": "Programming",
    "icon": "code",
    "description": "Bind local expression variables",
    "wrap": "let(r = 10, h = 20)",
    "body": "cylinder(h = h, r = r);"
  },
  {
    "id": "assert",
    "label": "Assert",
    "category": "Programming",
    "icon": "code",
    "description": "Stop when condition is false",
    "insert": "assert(width > 0, \"Width must be positive\");"
  },
  {
    "id": "echo",
    "label": "Echo",
    "category": "Programming",
    "icon": "code",
    "description": "Log variables during preview",
    "insert": "echo(\"width:\", width);"
  },
  {
    "id": "children",
    "label": "Children",
    "category": "Programming",
    "icon": "code",
    "description": "Render module child shapes",
    "insert": "module with_offset() {\n    translate([0,0,10]) children();\n}\nwith_offset() cube(10);"
  },
  {
    "id": "parameter",
    "label": "Slider parameter",
    "category": "Parameters",
    "icon": "settings",
    "description": "Expose adjustable customizer parameter",
    "insert": "width = 30; // [10:1:100]"
  },
  {
    "id": "parameter-block",
    "label": "Parameter group",
    "category": "Parameters",
    "icon": "settings",
    "description": "Customizer dimension group",
    "insert": "/* [Dimensions] */\nwidth = 30; // [10:1:100]\nheight = 15; // [5:1:50]"
  },
  {
    "id": "vector-parameter",
    "label": "Vector",
    "category": "Parameters",
    "icon": "settings",
    "description": "Reusable XYZ dimensions",
    "insert": "size = [20, 15, 10];\ncube(size, center = true);"
  },
  {
    "id": "boolean-parameter",
    "label": "Boolean toggle",
    "category": "Parameters",
    "icon": "settings",
    "description": "Customizer boolean option",
    "insert": "centered = true;\ncube([20,20,10], center = centered);"
  },
  {
    "id": "facets",
    "label": "$fn resolution",
    "category": "Parameters",
    "icon": "settings",
    "description": "Control smoothness of circular geometry",
    "insert": "$fn = 48;"
  },
  {
    "id": "range",
    "label": "Range",
    "category": "Parameters",
    "icon": "repeat",
    "description": "Iterate through numeric steps",
    "insert": "for (x = [0:5:30]) translate([x, 0, 0]) sphere(2);"
  },
  {
    "id": "include",
    "label": "Include",
    "category": "Files",
    "icon": "file",
    "description": "Import variables and modules from a file",
    "insert": "include <lib/shared.scad>;"
  },
  {
    "id": "use",
    "label": "Use",
    "category": "Files",
    "icon": "file",
    "description": "Import module/function definitions only",
    "insert": "use <lib/shared.scad>;"
  },
  {
    "id": "import-stl",
    "label": "Import STL",
    "category": "Files",
    "icon": "file",
    "description": "Insert STL mesh from project files",
    "insert": "import(\"mesh.stl\");"
  },
  {
    "id": "import-svg",
    "label": "Import SVG",
    "category": "Files",
    "icon": "file",
    "description": "Extrude an SVG drawing",
    "insert": "linear_extrude(height = 3) import(\"drawing.svg\");"
  },
  {
    "id": "surface",
    "label": "Heightmap",
    "category": "Files",
    "icon": "file",
    "description": "Load grayscale heightmap as geometry",
    "insert": "surface(file = \"heightmap.png\", center = true);"
  },
  {
    "id": "centered-block",
    "label": "Centered block",
    "category": "Templates",
    "icon": "box",
    "description": "Parametric centered box",
    "insert": "width = 30;\ndepth = 20;\nheight = 10;\ncube([width, depth, height], center = true);"
  },
  {
    "id": "rounded-plate",
    "label": "Rounded plate",
    "category": "Templates",
    "icon": "box",
    "description": "Rounded 2D plate with thickness",
    "insert": "linear_extrude(height = 3)\noffset(r = 4)\nsquare([30, 16], center = true);"
  },
  {
    "id": "tube",
    "label": "Tube",
    "category": "Templates",
    "icon": "cylinder",
    "description": "Hollow tube",
    "insert": "difference() {\n    cylinder(h = 30, r = 12, center = true, $fn = 64);\n    cylinder(h = 32, r = 8, center = true, $fn = 64);\n}"
  },
  {
    "id": "screw-hole",
    "label": "Screw hole",
    "category": "Templates",
    "icon": "minus",
    "description": "Subtract a mounting screw hole",
    "insert": "difference() {\n    cube([30, 20, 8], center = true);\n    cylinder(h = 10, r = 2.5, center = true, $fn = 40);\n}"
  },
  {
    "id": "hole-grid",
    "label": "Hole grid",
    "category": "Templates",
    "icon": "grid",
    "description": "Array of equally spaced holes",
    "insert": "for (x = [0:3], y = [0:2])\n    translate([x * 15, y * 15, 0]) cylinder(h = 8, r = 2, center = true);"
  },
  {
    "id": "radial-pattern",
    "label": "Radial pattern",
    "category": "Templates",
    "icon": "repeat",
    "description": "Rotate repeated shapes around Z",
    "insert": "for (i = [0:7])\n    rotate([0, 0, i * 45]) translate([20, 0, 0]) cylinder(h = 4, r = 3);"
  },
  {
    "id": "enclosure",
    "label": "Enclosure shell",
    "category": "Templates",
    "icon": "box",
    "description": "Open-top parametric housing",
    "insert": "outer = [60, 40, 25];\nwall = 2;\ndifference() {\n    cube(outer, center = true);\n    translate([0, 0, wall]) cube([outer[0] - 2 * wall, outer[1] - 2 * wall, outer[2]], center = true);\n}"
  },
  {
    "id": "mount-tab",
    "label": "Mount tab",
    "category": "Templates",
    "icon": "box",
    "description": "Simple plate with mounting hole",
    "insert": "difference() {\n    cube([24, 14, 4], center = true);\n    cylinder(h = 6, r = 3, center = true, $fn = 48);\n}"
  }
];

export const snippetCategories: readonly OpenScadSnippetCategory[] = ["Noteringar","Shapes","Transform","Booleans","2D & extrude","Modifiers","Programming","Parameters","Files","Templates"];

// On narrow screens these labels accompany the glyph. Never replace the
// complete OpenSCAD name in the accessible button or its description.
const snippetCaptions: Record<string, string> = {
  "double-arrow": "2-way",
  "polyhedron": "Polyhed",
  "multmatrix": "Matrix",
  "difference": "Diff",
  "disable": "Disable",
  "intersection": "Intersect",
  "linear-extrude": "Lin.Ext",
  "rotate-extrude": "Rot.Ext",
  "offset-chamfer": "Chamfer",
  "projection": "Project",
  "background": "Ghost",
  "if-else": "If/Else",
  "for": "For",
  "parameter": "Slider",
  "parameter-block": "Group",
  "boolean-parameter": "Toggle",
  "facets": "$fn",
  "import-stl": "STL",
  "import-svg": "SVG",
  "centered-block": "CenterBox",
  "rounded-plate": "RoundPlate",
  "screw-hole": "ScrewHole",
  "radial-pattern": "Radial",
  "enclosure": "Enclosure",
  "translate": "Translate",
  "children": "Children",
  "minkowski": "Minkowski",
  "highlight": "Highlight",
  "mount-tab": "Mount tab",
  "hole-grid": "Hole grid",
};

export function getOpenScadSnippetCaption(snippet: OpenScadSnippet): string {
  return snippetCaptions[snippet.id] ?? snippet.label;
}

export function insertOpenScadSnippet(snippet: OpenScadSnippet, selected = ''): string {
  if (snippet.insert !== undefined) return snippet.insert;
  if (!snippet.wrap) return '';
  const body = selected || snippet.body || '';
  const indented = body.split('\n').map(line => line.trim() ? '    ' + line : line).join('\n');
  return snippet.wrap + ' {\n' + indented + '\n}';
}
