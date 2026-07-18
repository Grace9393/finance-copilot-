/**
 * skills.ts — shared skill registry and invocation detection.
 *
 * The named skills mirror the SKILL.md definitions installed under
 * C:\Users\GRACEPAN\.bob\skills (plus three built-in quick actions). Both chat
 * handlers (Express route and Vercel serverless function) use this module so
 * skill routing behaves identically everywhere.
 *
 * A skill invocation always routes to Context Studio MCP. Recognised forms:
 *   1. "@skill-name rest of request"   — explicit @ prefix (unique-prefix match allowed)
 *   2. "Use the skill-name skill …"    — generic phrasing (what the drawer inserts)
 *   3. any message containing a skill name verbatim
 *
 * "@context …" is NOT a skill — it is the explicit Context Studio prefix and is
 * handled by the chat routers directly.
 */

/** Skills installed in .bob/skills. */
export const BOB_SKILL_NAMES = [
  'annual-report-analyzer',
  'earnings-peer-comparison',
  'financial-variance-analysis',
  'margin-lever-playbook',
  'file-to-pptx',
  'pdf-file-reader',
  'web-document-search',
] as const;

/** Built-in quick actions surfaced alongside the .bob skills. */
export const QUICK_ACTION_NAMES = [
  'annual-report-search',
  'web-search',
  'industry-search',
] as const;

export const SKILL_NAMES: readonly string[] = [...BOB_SKILL_NAMES, ...QUICK_ACTION_NAMES];

/**
 * Where each skill actually executes. Not everything is a Context Studio
 * query — several skills have real local implementations:
 *   'web'     — live internet search + page read (webSearch pipeline)
 *   'report'  — annual-report locate/fetch (reportSearch pipeline; CS fast-path if ingested)
 *   'enquiry' — finance enquiry engine (root cause / projection / liquidity)
 *   'data'    — answer from the connected data source (requires uploaded/connected data)
 *   'pptx'    — client-side file → editable PowerPoint via /api/pptx (needs an attached file)
 *   'context' — Context Studio MCP hybrid query (default for unknown skill names)
 */
export type SkillRoute = 'web' | 'report' | 'enquiry' | 'data' | 'pptx' | 'context';

export const SKILL_ROUTES: Record<string, SkillRoute> = {
  'annual-report-analyzer': 'report',
  'annual-report-search': 'report',
  'earnings-peer-comparison': 'web',
  'web-search': 'web',
  'industry-search': 'web',
  'web-document-search': 'web',
  'financial-variance-analysis': 'enquiry',
  'margin-lever-playbook': 'enquiry',
  'pdf-file-reader': 'data',
  'file-to-pptx': 'pptx'
};

export interface SkillInvocation {
  /** Canonical skill name */
  skill: string;
  /** Where this skill executes */
  route: SkillRoute;
  /** Message to send to Context Studio (with any @ prefix rewritten) */
  message: string;
  /** The user's free text with the skill invocation phrasing stripped */
  query: string;
}

/**
 * Detect a skill invocation and normalise the message.
 * Returns null when the message is not a skill invocation (including "@context").
 */
export function detectSkillInvocation(raw: string): SkillInvocation | null {
  const message = raw.trim();
  const lower = message.toLowerCase();

  // "@skill-name …" — explicit prefix. "@context" is reserved for Context Studio.
  if (lower.startsWith('@') && !lower.startsWith('@context')) {
    const prefixMatch = message.match(/^@([\w-]+)\s*/);
    if (prefixMatch) {
      const token = prefixMatch[1].toLowerCase();
      const match =
        SKILL_NAMES.find((name) => name === token) ??
        SKILL_NAMES.find((name) => name.startsWith(token));
      if (match) {
        const rest = message.slice(prefixMatch[0].length).trim();
        return {
          skill: match,
          route: SKILL_ROUTES[match] ?? 'context',
          message: rest ? `Use the ${match} skill: ${rest}` : `Use the ${match} skill.`,
          query: rest
        };
      }
    }
  }

  // "Use the X skill …" — generic pattern (inserted by the client Skills drawer)
  const genericMatch = message.match(/\buse\s+the\s+([\w-]+)\s+skill\b(?:\s*(?:to|for|on|:))?\s*/i);
  if (genericMatch) {
    const name = genericMatch[1].toLowerCase();
    return {
      skill: name,
      route: SKILL_ROUTES[name] ?? 'context',
      message,
      query: message.slice((genericMatch.index ?? 0) + genericMatch[0].length).trim()
    };
  }

  // Explicit skill name anywhere in the message (names are unique enough)
  for (const name of SKILL_NAMES) {
    if (lower.includes(name)) {
      return {
        skill: name,
        route: SKILL_ROUTES[name] ?? 'context',
        message,
        query: message.replace(new RegExp(name, 'ig'), '').replace(/\s{2,}/g, ' ').trim()
      };
    }
  }

  return null;
}
