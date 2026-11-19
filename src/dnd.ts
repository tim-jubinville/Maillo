import { t } from './i18n';
import { setState } from './store';

// Custom types so drops only react to drags that started inside Maillo.
const THREADS = 'application/x-maillo-threads';
const LABEL = 'application/x-maillo-label';

export type DragKind = 'threads' | 'label';

function ghost(text: string, e: DragEvent) {
  const el = document.createElement('div');
  el.className = 'drag-ghost';
  el.textContent = text;
  document.body.appendChild(el);
  e.dataTransfer?.setDragImage(el, 14, 14);
  setTimeout(() => el.remove(), 0);
}

export function startThreadDrag(e: DragEvent, ids: string[]) {
  if (!e.dataTransfer || !ids.length) return;
  e.dataTransfer.setData(THREADS, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'move';
  ghost(t('dnd.threads', { n: ids.length }), e);
  // After the drag image is taken, so the image isn't affected by the re-render.
  setTimeout(() => setState({ dragging: 'threads' }), 0);
}

export function startLabelDrag(e: DragEvent, labelId: string, name: string) {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(LABEL, labelId);
  e.dataTransfer.effectAllowed = 'copy';
  ghost(name, e);
  setTimeout(() => setState({ dragging: 'label' }), 0);
}

export function endDrag() {
  setState({ dragging: undefined });
}

/**
 * Props that make an element accept a drop of `kind`. The element gets the `drop-on` class
 * while something droppable is over it.
 */
export function dropZone(kind: DragKind, onDrop: (payload: string[]) => void) {
  const type = kind === 'threads' ? THREADS : LABEL;
  const accepts = (e: DragEvent) => !!e.dataTransfer?.types.includes(type);
  return {
    onDragOver: (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = kind === 'threads' ? 'move' : 'copy';
      (e.currentTarget as HTMLElement).classList.add('drop-on');
    },
    onDragLeave: (e: DragEvent) => {
      const el = e.currentTarget as HTMLElement;
      if (!el.contains(e.relatedTarget as Node | null)) el.classList.remove('drop-on');
    },
    onDrop: (e: DragEvent) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as HTMLElement).classList.remove('drop-on');
      const raw = e.dataTransfer!.getData(type);
      endDrag();
      if (!raw) return;
      if (kind === 'label') onDrop([raw]);
      else {
        try {
          const ids = JSON.parse(raw);
          if (Array.isArray(ids)) onDrop(ids.filter((x): x is string => typeof x === 'string'));
        } catch {
          /* not ours */
        }
      }
    }
  };
}
