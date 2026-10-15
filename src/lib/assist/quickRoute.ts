// Routes the to-dos whose wording settles it, saving a model round trip
// (often the slowest part of a turn). Returns null when a rule cannot tell;
// the model router handles those.

import type { Route } from './parse';
import type { Target } from './projects';

const DRAFT = /\b(e-?mail|write|draft|reply|respond|text|message|dm|letter|send|thank[- ]you note|complain|follow[- ]up with)\b/i;
const PROJECT = /\b(timeline|deadline|schedule|tasks?|phase|milestone|due date|push|slip|move|shift|delay|reschedule|update|add)\b/i;
const QUESTION = /^(how|what|which|why|when|where|who|should|can|is|are|do|does)\b|\?\s*$|\b(research|figure out|find out|look up|compare|decide|choose|pick)\b/i;
const STEPS = /\b(plan|organi[sz]e|prepare|prep|pack|clean|fix|set up|setup|book|arrange|declutter|move|renew|apply|file|finish|start|get ready)\b/i;

const STOP = new Set(['the', 'a', 'an', 'to', 'for', 'about', 'with', 'my', 'our', 'of', 'on', 'in', 'and', 'or', 'at', 'from', 'that', 'this', 'it', 'is', 'be', 'me', 'up']);

/** A few content words to look up in the person's notes, OR-joined for websearch_to_tsquery. */
export function searchTerms(todo: string): string | null {
  const words = todo.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !DRAFT.test(w));
  const picked = Array.from(new Set(words)).slice(0, 5);
  return picked.length ? picked.join(' or ') : null;
}

function namedTarget(todo: string, targets: Target[]): Target | null {
  const t = todo.toLowerCase();
  const hits = targets.filter((x) => x.name.length > 2 && t.includes(x.name.toLowerCase()));
  return hits.sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}

// A named project decides only when the words around its name ask for a change;
// "Plan packing for the office move" names Office Move but may want steps.
export function quickRoute(todo: string, targets: Target[]): Route | null {
  const named = namedTarget(todo, targets);
  if (DRAFT.test(todo)) return { intent: 'draft', target: null, search: searchTerms(todo) };
  if (named) {
    const rest = todo.toLowerCase().replace(named.name.toLowerCase(), ' ');
    return PROJECT.test(rest) ? { intent: 'project', target: named.name, search: null } : null;
  }
  if (QUESTION.test(todo)) return { intent: 'answer', target: null, search: searchTerms(todo) };
  if (STEPS.test(todo)) return { intent: 'steps', target: null, search: searchTerms(todo) };
  return null;
}
