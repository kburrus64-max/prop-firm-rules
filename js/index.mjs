// prop-firm-rules (Node entry point): the calculator plus the bundled, sourced rules dataset.
// Browser use: import './calc.mjs' directly and fetch data/firms.json yourself.
import { readFileSync } from 'node:fs';
export * from './calc.mjs';
import { evaluate } from './calc.mjs';

/** The full dataset (firms, programs, policies, sources, lastVerified dates). */
export const rules = JSON.parse(readFileSync(new URL('../data/firms.json', import.meta.url), 'utf8'));

/** Flat list of every program, each tagged with its firm id/name. */
export function listPrograms() {
  return rules.firms.flatMap((f) => f.programs.map((p) => ({ firmId: f.id, firmName: f.name, ...p })));
}

/** Look up a program by id (e.g. "ftmo_2step"). Returns undefined if unknown. */
export function getProgram(id) {
  return listPrograms().find((p) => p.id === id);
}

/** Look up a firm (with its programs and copy-trading/automation policy) by id. */
export function getFirm(id) {
  return rules.firms.find((f) => f.id === id);
}

/** Convenience: evaluate(...) with a program id instead of a program object. */
export function check(programId, input) {
  const program = getProgram(programId);
  if (!program) throw new Error(`Unknown program id: ${programId}`);
  return evaluate({ ...input, program });
}
