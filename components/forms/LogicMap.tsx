'use client';

/**
 * Question logic — the form's conditional questions as a map.
 *
 * Every question is a card. A choice or yes/no question shows its answers down
 * its right edge; drag from an answer onto the question it unlocks. A table is
 * one card with its columns inside: drag between columns for a same-row rule,
 * or from an outside question onto the table (or one column).
 *
 * The map only DRAWS and forwards gestures. What a gesture means — widening to
 * "is one of", replacing a rule, refusing a key column or a loop, moving a
 * follow-up below its parent — is decided in lib/fieldConditions
 * (connectCondition / disconnectCondition), the same module the server mirrors.
 * Edits go into the dialog's field state and are saved with its normal Save.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, Background, Controls, Handle, Position, BaseEdge, EdgeLabelRenderer,
  getBezierPath, useNodesState, type NodeChange,
  type Node, type Edge, type NodeProps, type EdgeProps, type Connection, type FinalConnectionState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GitBranch, Lock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FormField } from '@/types/api';
import {
  answerChoices, conditionDepth, conditionOf, connectCondition, disconnectCondition,
  labelOf, validateConditions, type LogicEnd,
} from '@/lib/fieldConditions';

type F = FormField & { _isDeleted?: boolean; key_columns?: string[]; anchor_columns?: string[] };

const COL_W = 320;
const GAP = 28;
const HEAD = 46;
const ROW = 28;

// ── nodes ────────────────────────────────────────────────────────────────────

type QData = { label: string; type: string; answers: string[]; ruled: boolean; editable: boolean; onOpen?: () => void };
type TData = {
  label: string; ruled: boolean; editable: boolean; onOpen?: () => void;
  cols: Array<{
    name: string; label: string; answers: string[]; isKey: boolean; ruled: boolean;
    /** Same-row rule, drawn on the column itself rather than as a loop. */
    rowRule?: { parent: string; values: string[] };
  }>;
  onRemoveRowRule?: (col: string, value: string) => void;
};

const dot = '!h-2.5 !w-2.5 !border-2 !border-white dark:!border-[#0e0e0e]';

function QuestionNode({ data }: NodeProps<Node<QData>>) {
  return (
    <div className={cn('w-[240px] rounded-xl border bg-white shadow-sm dark:bg-[#141414]',
      data.ruled ? 'border-slate-300 dark:border-[#333]' : 'border-gray-200 dark:border-[#262626]')}>
      <div className="relative flex items-center gap-2 px-3" style={{ height: HEAD }} onDoubleClick={data.onOpen}>
        <Handle type="target" position={Position.Left} id="in" className={cn(dot, '!bg-gray-400')} />
        <span className="text-[11px] text-gray-400">{data.type === 'boolean' ? '◐' : data.type === 'select' ? '⊙' : '⊡'}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-800 dark:text-zinc-100" title={data.label}>{data.label}</span>
      </div>
      {data.answers.length > 0 && (
        <div className="border-t border-gray-100 py-1 dark:border-[#222]">
          {data.answers.map(a => (
            <div key={a} className="relative flex items-center justify-end px-3 text-[11px] text-gray-500 dark:text-zinc-400" style={{ height: ROW }}>
              <span className="truncate">{a}</span>
              <Handle type="source" position={Position.Right} id={`a:${a}`}
                isConnectable={data.editable} className={cn(dot, '!bg-gray-900 dark:!bg-zinc-200')} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TableNode({ data }: NodeProps<Node<TData>>) {
  return (
    <div className={cn('w-[260px] rounded-xl border bg-white shadow-sm dark:bg-[#141414]',
      data.ruled ? 'border-slate-300 dark:border-[#333]' : 'border-gray-200 dark:border-[#262626]')}>
      <div className="relative flex items-center gap-2 px-3" style={{ height: HEAD }} onDoubleClick={data.onOpen}>
        <Handle type="target" position={Position.Left} id="in" className={cn(dot, '!bg-gray-400')} />
        <span className="text-[11px] text-gray-400">▦</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-800 dark:text-zinc-100" title={data.label}>{data.label}</span>
        <span className="text-[10px] uppercase tracking-wider text-gray-400">table</span>
      </div>
      <div className="border-t border-gray-100 py-1 dark:border-[#222]">
        {data.cols.map(c => (
          <div key={c.name}>
            <div data-logic-col={c.name} className="relative flex items-center gap-1.5 pl-5 pr-3 text-[12px] text-gray-700 dark:text-zinc-300" style={{ height: ROW }}>
              {c.isKey
                ? <Lock className="h-3 w-3 shrink-0 text-gray-300" aria-label="Identifies a row — always asked" />
                : <Handle type="target" position={Position.Left} id={`c-in:${c.name}`} className={cn(dot, '!bg-gray-400')} />}
              <span className={cn('truncate', c.rowRule && 'pl-3')} title={c.isKey ? `${c.label} identifies a row, so it is always asked` : c.label}>
                {c.rowRule && <span className="mr-1 text-gray-300">↳</span>}{c.label}
              </span>
              {c.rowRule && (
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  {c.rowRule.values.map(v => (
                    <span key={v} className="nodrag flex items-center gap-0.5 rounded-full border border-slate-200 bg-slate-50 px-1.5 text-[10px] text-slate-600 dark:border-[#333] dark:bg-[#1a1a1a] dark:text-zinc-300">
                      if {c.rowRule!.parent}: {v}
                      {data.editable && (
                        <button type="button" title="Remove this rule" onClick={() => data.onRemoveRowRule?.(c.name, v)}
                          className="text-slate-300 hover:text-red-500"><X className="h-2.5 w-2.5" /></button>
                      )}
                    </span>
                  ))}
                </span>
              )}
            </div>
            {c.answers.map(a => (
              <div key={a} className="relative flex items-center justify-end px-3 text-[11px] text-gray-400 dark:text-zinc-500" style={{ height: ROW - 4 }}>
                <span className="truncate">{a}</span>
                <Handle type="source" position={Position.Right} id={`c:${c.name}:a:${a}`}
                  isConnectable={data.editable} className={cn(dot, '!bg-gray-700 dark:!bg-zinc-300')} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── edge: the answer it needs, and × to remove it ────────────────────────────

type RData = { value: string; editable: boolean; onRemove: () => void };

function RuleEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<Edge<RData>>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: '#94a3b8', strokeWidth: 1.5 }} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] text-slate-600 shadow-sm dark:border-[#333] dark:bg-[#161616] dark:text-zinc-300"
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, zIndex: 1001 }}
        >
          if {data?.value}
          {data?.editable && (
            <button type="button" onClick={data.onRemove} title="Remove this rule"
              className="text-slate-300 hover:text-red-500"><X className="h-3 w-3" /></button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { question: QuestionNode, table: TableNode };
const edgeTypes = { rule: RuleEdge };

// ── the panel ────────────────────────────────────────────────────────────────

export function LogicMap({ fields, editable, onChange, onClose, onOpenField }: {
  fields: F[];
  editable: boolean;
  onChange: (next: F[]) => void;
  onClose: () => void;
  onOpenField?: (name: string) => void;
}) {
  const live = useMemo(() => fields.filter(f => !f._isDeleted && f.field_name.trim()), [fields]);
  const [note, setNote] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [onlyLogic, setOnlyLogic] = useState(false);
  const removeRef = useRef<(dst: LogicEnd, value: string) => void>(() => {});
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const inLogic = useMemo(() => {
    const s = new Set<string>();
    for (const f of live) {
      const c = conditionOf(f);
      if (c) { s.add(f.field_name); s.add(c.field); }
      for (const col of (f.subform_fields || []) as F[]) {
        const cc = conditionOf(col);
        if (cc) { s.add(f.field_name); if (cc.from !== 'row') s.add(cc.field); }
      }
    }
    return s;
  }, [live]);

  const shownFields = useMemo(
    () => (onlyLogic ? live.filter(f => inLogic.has(f.field_name)) : live),
    [live, onlyLogic, inLogic],
  );

  // Layout: one column per step of the chain; a follow-up starts level with the
  // question that unlocks it, so each branch reads left to right.
  const computed = useMemo<Node[]>(() => {
    const colY: number[] = [];
    const yOf = new Map<string, number>();
    return shownFields.map(f => {
      const depth = conditionDepth(live as any, f.field_name);
      const isTable = f.field_type === 'array';
      const keys = new Set((f.key_columns || f.anchor_columns || []) as string[]);
      const colsRaw = (f.subform_fields || []) as F[];
      const cols = colsRaw.map(c => {
        const cc = conditionOf(c);
        return {
          name: c.field_name, label: labelOf(c),
          answers: ['select', 'boolean'].includes(c.field_type) ? answerChoices(c as any) : [],
          isKey: keys.has(c.field_name), ruled: !!cc,
          ...(cc && cc.from === 'row'
            ? { rowRule: { parent: labelOf(colsRaw.find(x => x.field_name === cc.field), cc.field), values: cc.values } }
            : {}),
        };
      });
      const answers = !isTable && ['select', 'boolean'].includes(f.field_type) ? answerChoices(f as any) : [];
      const height = HEAD + (isTable
        ? 8 + cols.reduce((h, c) => h + ROW + c.answers.length * (ROW - 4), 0)
        : answers.length ? 8 + answers.length * ROW : 0);
      const parent = conditionOf(f)?.field;
      const y = Math.max(colY[depth] ?? 0, parent && yOf.has(parent) ? yOf.get(parent)! : 0);
      colY[depth] = y + height + GAP;
      yOf.set(f.field_name, y);
      const open = onOpenField ? () => onOpenField(f.field_name) : undefined;
      return isTable
        ? { id: f.field_name, type: 'table', position: { x: depth * COL_W, y },
            data: { label: labelOf(f), ruled: !!conditionOf(f), editable, cols, onOpen: open,
                    onRemoveRowRule: (col: string, v: string) => removeRef.current({ field: f.field_name, column: col }, v) } satisfies TData }
        : { id: f.field_name, type: 'question', position: { x: depth * COL_W, y },
            data: { label: labelOf(f), type: f.field_type, answers, ruled: !!conditionOf(f), editable, onOpen: open } satisfies QData };
    });
  }, [shownFields, live, editable, onOpenField]);

  // A card the reviewer dragged stays where they put it; every other card
  // follows the layout, so a new rule moves its follow-up into the next column.
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const dragged = useRef<Set<string>>(new Set());
  const handleNodesChange = useCallback((changes: NodeChange<Node>[]) => {
    for (const c of changes) if (c.type === 'position' && c.dragging) dragged.current.add(c.id);
    onNodesChange(changes);
  }, [onNodesChange]);
  useEffect(() => {
    setNodes(prev => {
      const byId = new Map(prev.map(n => [n.id, n]));
      return computed.map(n => {
        const p = byId.get(n.id);
        if (!p) return n;
        return { ...n, measured: p.measured, position: dragged.current.has(n.id) ? p.position : n.position };
      });
    });
  }, [computed, setNodes]);

  const remove = useCallback((dst: LogicEnd, value: string) => {
    onChange(disconnectCondition(fields as any, dst, value) as F[]);
    setNote(null);
  }, [fields, onChange]);
  removeRef.current = remove;

  const edges = useMemo<Edge[]>(() => {
    const shown = new Set(shownFields.map(f => f.field_name));
    const out: Edge[] = [];
    const push = (source: string, sourceHandle: string, target: string, targetHandle: string, value: string, dst: LogicEnd) => {
      if (!shown.has(source) || !shown.has(target)) return;
      out.push({
        id: `${target}|${targetHandle}|${value}`, type: 'rule', source, sourceHandle, target, targetHandle,
        data: { value, editable, onRemove: () => remove(dst, value) } satisfies RData,
      });
    };
    for (const f of live) {
      const c = conditionOf(f);
      if (c) for (const v of c.values) push(c.field, `a:${v}`, f.field_name, 'in', v, { field: f.field_name });
      for (const col of (f.subform_fields || []) as F[]) {
        const cc = conditionOf(col);
        if (!cc) continue;
        for (const v of cc.values) {
          // Same-row rules are shown on the column itself (see TableNode).
          if (cc.from !== 'row') push(cc.field, `a:${v}`, f.field_name, `c-in:${col.field_name}`, v, { field: f.field_name, column: col.field_name });
        }
      }
    }
    return out;
  }, [live, shownFields, editable, remove]);

  const onConnect = useCallback((c: Connection) => {
    if (!editable || !c.source || !c.target || !c.sourceHandle) return;
    let src: LogicEnd & { value: string };
    if (c.sourceHandle.startsWith('c:')) {
      const rest = c.sourceHandle.slice(2);
      const i = rest.indexOf(':a:');
      src = { field: c.source, column: rest.slice(0, i), value: rest.slice(i + 3) };
    } else {
      src = { field: c.source, value: c.sourceHandle.slice(2) };
    }
    const dst: LogicEnd = c.targetHandle?.startsWith('c-in:')
      ? { field: c.target, column: c.targetHandle.slice(5) }
      : { field: c.target };
    const res = connectCondition(fields as any, src, dst);
    if (res.error) { setNote({ text: res.error, tone: 'error' }); return; }
    onChange(res.fields as F[]);
    setNote(res.note ? { text: res.note, tone: 'info' } : null);
  }, [editable, fields, onChange]);

  // Dropping anywhere on a card (or on a column's row) counts, not only on its
  // small left dot: when the drop missed every handle, find what is under the
  // pointer and connect to that.
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (!editable || !('fromHandle' in state) || !state.fromHandle || state.isValid) return;
    const pt = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent);
    const el = document.elementFromPoint(pt.clientX, pt.clientY) as HTMLElement | null;
    const nodeEl = el?.closest('.react-flow__node');
    const target = nodeEl?.getAttribute('data-id');
    if (!target || !state.fromNode) return;
    const col = el?.closest('[data-logic-col]')?.getAttribute('data-logic-col');
    onConnect({
      source: state.fromNode.id, sourceHandle: state.fromHandle.id ?? null,
      target, targetHandle: col ? `c-in:${col}` : 'in',
    });
  }, [editable, onConnect]);

  const errors = useMemo(() => validateConditions(live as any), [live]);
  const hasParents = live.some(f => ['select', 'boolean'].includes(f.field_type)
    || ((f.subform_fields || []) as F[]).some(c => ['select', 'boolean'].includes(c.field_type)));

  return (
    <div className="absolute inset-0 z-30 flex flex-col rounded-2xl bg-white dark:bg-[#0e0e0e]">
      <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-6 py-4 dark:border-[#1a1a1a]">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight text-gray-900 dark:text-white">
            <GitBranch className="h-4 w-4" /> Question logic
          </h3>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400">
            {editable
              ? 'Drag from an answer to the question it unlocks. That question is only asked after that answer; otherwise it is saved as NA. Click × on an arrow to remove it.'
              : 'Which answers unlock which questions.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-gray-500 dark:text-zinc-400">
            <input type="checkbox" checked={onlyLogic} onChange={e => setOnlyLogic(e.target.checked)} className="h-3 w-3" />
            Only questions with logic
          </label>
          <button type="button" onClick={onClose}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700 dark:bg-zinc-100 dark:text-gray-900">
            Done
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {!hasParents ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-zinc-400">
            Add a choice or Yes/No question first — only those can unlock follow-up questions.
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={handleNodesChange}
            onConnect={onConnect}
            onConnectEnd={onConnectEnd}
            nodesConnectable={editable}
            isValidConnection={() => true}
            colorMode={dark ? 'dark' : 'light'}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.25}
            deleteKeyCode={null}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>

      {(note || errors.length > 0) && (
        <div className="flex-shrink-0 border-t border-gray-100 px-6 py-2.5 text-[12px] dark:border-[#1a1a1a]">
          {note && <p className={note.tone === 'error' ? 'text-red-500' : 'text-slate-600 dark:text-zinc-400'}>{note.text}</p>}
          {errors.map(e => <p key={e} className="text-red-500">{e}</p>)}
        </div>
      )}
    </div>
  );
}
