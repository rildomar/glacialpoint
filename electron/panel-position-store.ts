import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface PanelPosition { x: number; y: number; }

// Posição da janela escolhida ao arrastar pelo cabeçalho. A leitura é tolerante:
// qualquer valor estranho volta para o encaixe junto à bandeja, e a gravação é
// melhor esforço — perder a posição não pode atrapalhar o aplicativo.
export function panelPositionStore(directory: string) {
  const file = path.join(directory, 'panel-position.json');
  return {
    read(): PanelPosition | null {
      if (!existsSync(file)) return null;
      try {
        const value = JSON.parse(readFileSync(file, 'utf8')) as { x?: unknown; y?: unknown };
        if (typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y)) return { x: value.x, y: value.y };
        return null;
      } catch { return null; }
    },
    write(position: PanelPosition) {
      try {
        mkdirSync(directory, { recursive: true });
        writeFileSync(file + '.tmp', JSON.stringify({ version: 1, ...position }), 'utf8');
        renameSync(file + '.tmp', file);
      } catch { /* posição é conveniência, não requisito */ }
    },
  };
}
