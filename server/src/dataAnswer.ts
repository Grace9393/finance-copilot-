/**
 * dataAnswer.ts — answer questions directly from a loaded data context
 * (uploaded file / local path / web URL / Google Sheet / fetched report).
 *
 * Context Studio's query tools are retrieval tools over the ingested knowledge
 * base — they cannot read ad-hoc uploaded data. So when a data context is
 * loaded and the user asks a plain question in hybrid mode, we answer from the
 * data itself: matching document chunks for text datasets, matching rows +
 * numeric aggregates for tabular datasets. @context / vector / graph / skills
 * still route to Context Studio.
 */

export interface DataContextShape {
  source: string;
  fields: string[];
  rows: Record<string, string | number>[];
  kpis?: Record<string, number>;
  narrative?: string;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'is', 'are', 'was', 'were',
  'what', 'which', 'who', 'how', 'why', 'when', 'where', 'this', 'that', 'these', 'those',
  'data', 'file', 'about', 'me', 'my', 'our', 'your', 'their', 'its', 'with', 'from', 'by',
  'summarize', 'summarise', 'summary', 'show', 'tell', 'give', 'list', 'please', 'can', 'you',
  'much', 'many', 'does', 'did', 'has', 'have', 'had', 'per', 'total', 'overall', 'it'
]);

function queryTerms(message: string): string[] {
  return [...new Set(
    message.toLowerCase().split(/[^\p{L}\p{N}%.]+/u)
      .map((t) => t.trim())
      .filter((t) => t.length > 2 && !STOPWORDS.has(t))
  )];
}

function isTextDataset(ctx: DataContextShape): boolean {
  return ctx.fields.includes('text') && ctx.fields.length <= 3;
}

function tableJson(rows: Record<string, string | number>[]): string {
  return '```json\n' + JSON.stringify(rows, null, 1) + '\n```';
}

// ── Text datasets (pdf / pptx / docx / articles → chunks) ─────────────────────

function answerFromText(message: string, ctx: DataContextShape): string {
  const terms = queryTerms(message);
  const scored = ctx.rows
    .map((row) => {
      const text = String(row.text ?? '');
      const lower = text.toLowerCase();
      const score = terms.reduce((n, term) => n + (lower.includes(term) ? 1 : 0), 0);
      return { row, text, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  const lines: string[] = [`## From ${ctx.source}`, ''];

  if (scored.length > 0) {
    lines.push(`**Most relevant passages** (matched: ${terms.slice(0, 8).join(', ')}):`, '');
    for (const entry of scored) {
      lines.push(`> ${entry.text.length > 600 ? entry.text.slice(0, 600) + '…' : entry.text}`, '');
    }
  } else {
    lines.push('**No passage matched the question directly — document opening:**', '');
    for (const row of ctx.rows.slice(0, 5)) {
      lines.push(`> ${String(row.text ?? '').slice(0, 400)}`, '');
    }
  }

  lines.push(`_Source: ${ctx.source} (${ctx.rows.length} passages loaded). Prefix with **@context** to query the Context Studio knowledge base instead._`);
  return lines.join('\n');
}

// ── Tabular datasets ──────────────────────────────────────────────────────────

function numericFields(ctx: DataContextShape): string[] {
  return ctx.fields.filter((field) =>
    ctx.rows.length > 0 &&
    ctx.rows.every((row) => row[field] === '' || typeof row[field] === 'number')
  );
}

function answerFromTable(message: string, ctx: DataContextShape): string {
  const terms = queryTerms(message);
  const lines: string[] = [`## From ${ctx.source}`, ''];

  // Rows whose values match the query terms
  const matches = terms.length > 0
    ? ctx.rows.filter((row) =>
        terms.some((term) => Object.values(row).some((v) => String(v).toLowerCase().includes(term))))
    : [];
  if (matches.length > 0 && matches.length < ctx.rows.length) {
    lines.push(`**Rows matching ${terms.slice(0, 6).join(', ')}** (${matches.length} of ${ctx.rows.length}):`, '');
    lines.push(tableJson(matches.slice(0, 15)));
    lines.push('');
  }

  // Numeric aggregates
  const numerics = numericFields(ctx).slice(0, 8);
  if (numerics.length > 0) {
    const statsRows = numerics.map((field) => {
      const values = ctx.rows.map((row) => Number(row[field])).filter((v) => Number.isFinite(v));
      const sum = values.reduce((a, b) => a + b, 0);
      return {
        Field: field,
        Rows: values.length,
        Total: Math.round(sum * 100) / 100,
        Average: values.length ? Math.round((sum / values.length) * 100) / 100 : 0,
        Min: values.length ? Math.min(...values) : 0,
        Max: values.length ? Math.max(...values) : 0
      };
    });
    lines.push('**Numeric summary:**', '');
    lines.push(tableJson(statsRows));
    lines.push('');
  }

  // Preview when nothing matched
  if (matches.length === 0) {
    lines.push(`**Preview** (first ${Math.min(10, ctx.rows.length)} of ${ctx.rows.length} rows · fields: ${ctx.fields.join(', ')}):`, '');
    lines.push(tableJson(ctx.rows.slice(0, 10)));
    lines.push('');
  }

  lines.push(`_Answered from the connected data source (${ctx.rows.length} rows). Prefix with **@context** to query the Context Studio knowledge base instead._`);
  return lines.join('\n');
}

// ── Entry point ───────────────────────────────────────────────────────────────

export function answerFromDataContext(message: string, ctx: DataContextShape): string {
  return isTextDataset(ctx) ? answerFromText(message, ctx) : answerFromTable(message, ctx);
}
