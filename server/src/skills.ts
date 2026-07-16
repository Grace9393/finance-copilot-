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

export interface SkillInvocation {
  /** Canonical skill name */
  skill: string;
  /** Message to send to Context Studio (with any @ prefix rewritten) */
  message: string;
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
          message: rest ? `Use the ${match} skill: ${rest}` : `Use the ${match} skill.`
        };
      }
    }
  }

  // "Use the X skill …" — generic pattern (inserted by the client Skills drawer)
  const genericMatch = message.match(/\buse\s+the\s+([\w-]+)\s+skill\b/i);
  if (genericMatch) return { skill: genericMatch[1].toLowerCase(), message };

  // Explicit skill name anywhere in the message (names are unique enough)
  for (const name of SKILL_NAMES) {
    if (lower.includes(name)) return { skill: name, message };
  }

  return null;
}
