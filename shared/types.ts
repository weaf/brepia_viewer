import type { OpenScadProject } from './openScadProject.ts';

export type Model = string;
export type MeshFileType = string;
export type Mesh = { id: string; fileType: MeshFileType };
export type ParametricArtifact = {
  title: string;
  version: string;
  project: OpenScadProject;
};
export type ParameterOption = { value: string | number; label?: string };
export type ParameterRange = { min?: number; max?: number; step?: number };
export type ParameterType =
  | 'string' | 'number' | 'boolean'
  | 'string[]' | 'number[]' | 'boolean[]';
export type Parameter = {
  name: string;
  displayName: string;
  value: string | boolean | number | string[] | number[] | boolean[];
  defaultValue: string | boolean | number | string[] | number[] | boolean[];
  type?: ParameterType;
  description?: string;
  group?: string;
  range?: ParameterRange;
  options?: ParameterOption[];
  maxLength?: number;
};
