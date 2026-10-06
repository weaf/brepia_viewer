import { ActivityIndicator } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { ThreeScene } from '@/components/viewer/ThreeScene';
import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { getOpenScadEntrypoint, type OpenScadProject } from '@shared/openScadProject';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BufferGeometry, Group } from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { buildColoredGroupFromOff, disposeColoredGroup } from '@/utils/coloredOffMesh';
import { downloadSTLFile } from '@/utils/downloadUtils';

export function LocalOpenScadPreview({
  project,
  assets,
}: {
  project: OpenScadProject;
  assets: Record<string, Blob>;
}) {
  const { compileProject, writeFile, isCompiling, output, offOutput, error, isError } = useOpenSCAD();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [coloredGroup, setColoredGroup] = useState<Group | null>(null);
  const mountedGroupRef = useRef<Group | null>(null);
  const mountedGeometryRef = useRef<BufferGeometry | null>(null);
  const compileSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    compileSequence.current += 1;

    void (async () => {
      try {
        for (const asset of project.assets ?? []) {
          const blob = assets[asset.path];
          if (!blob) throw new Error(`Missing local model asset: ${asset.path}`);
          await writeFile(asset.path, blob);
        }
        if (!cancelled) await compileProject(project);
      } catch (cause) {
        console.error('[Gallery preview] Could not compile OpenSCAD project:', cause);
      }
    })();
    return () => {
      cancelled = true;
      compileSequence.current += 1;
    };
  }, [assets, compileProject, project, writeFile]);

  useEffect(() => {
    if (!(output instanceof Blob)) {
      mountedGeometryRef.current?.dispose();
      mountedGeometryRef.current = null;
      setGeometry(null);
      return;
    }
    let cancelled = false;
    void output.arrayBuffer().then((buffer) => {
      if (cancelled) return;
      const next = new STLLoader().parse(buffer);
      next.center();
      next.computeVertexNormals();
      mountedGeometryRef.current?.dispose();
      mountedGeometryRef.current = next;
      setGeometry(next);
    }).catch((cause: unknown) => {
      console.error('[Gallery preview] Could not parse OpenSCAD output:', cause);
    });
    return () => { cancelled = true; };
  }, [output]);

  useEffect(() => {
    if (!(offOutput instanceof Blob)) {
      if (mountedGroupRef.current) disposeColoredGroup(mountedGroupRef.current);
      mountedGroupRef.current = null;
      setColoredGroup(null);
      return;
    }
    let cancelled = false;
    void offOutput.text().then((text) => {
      if (cancelled) return;
      const group = buildColoredGroupFromOff(text, 0x00a6ff);
      if (mountedGroupRef.current) disposeColoredGroup(mountedGroupRef.current);
      mountedGroupRef.current = group;
      setColoredGroup(group);
    }).catch((cause: unknown) => {
      console.error('[Gallery preview] Could not parse color data:', cause);
    });
    return () => { cancelled = true; };
  }, [offOutput]);

  useEffect(() => () => {
    if (mountedGroupRef.current) disposeColoredGroup(mountedGroupRef.current);
    mountedGeometryRef.current?.dispose();
  }, []);

  const entrypoint = getOpenScadEntrypoint(project);
  return (
    <section className="relative flex h-full min-h-[22rem] flex-col overflow-hidden rounded-xl border border-adam-neutral-700 bg-adam-neutral-800" aria-label="3D model preview">
      <div className="absolute left-3 top-3 z-10 rounded-md border border-white/10 bg-black/45 px-2.5 py-1.5 font-mono text-[10px] text-white/75">
        {entrypoint.path}
      </div>
      {(geometry || coloredGroup) && (
        <div className="min-h-0 flex-1">
          <ThreeScene geometry={geometry} coloredGroup={coloredGroup} color="#00A6FF" />
        </div>
      )}
      {isCompiling && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/35 backdrop-blur-sm">
          <ActivityIndicator label="Compiling model" size="lg" />
        </div>
      )}
      {!isCompiling && !geometry && !coloredGroup && (
        <div className="flex min-h-[22rem] flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          {isError ? <AlertTriangle className="h-7 w-7 text-amber-400" /> : <RefreshCw className="h-6 w-6 animate-spin text-adam-neutral-400" />}
          <p className="max-w-lg text-sm text-adam-neutral-300">
            {isError ? error?.message ?? 'OpenSCAD could not compile this model.' : 'Preparing model preview…'}
          </p>
        </div>
      )}
      <div className="absolute bottom-3 right-3 z-10">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!output || isCompiling}
          onClick={() => output && downloadSTLFile(output)}
          className="gap-2 border-white/15 bg-black/45 text-white hover:bg-black/70"
        >
          <Download className="h-3.5 w-3.5" />
          Download STL
        </Button>
      </div>
    </section>
  );
}
