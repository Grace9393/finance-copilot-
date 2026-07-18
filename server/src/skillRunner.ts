/**
 * skillRunner.ts — execute skills on their real implementations.
 *
 * Shared by the Express chat route and the Vercel serverless handler so skill
 * behaviour is identical everywhere. Routes (see skills.ts SKILL_ROUTES):
 *   web     → live internet search + page read
 *   report  → annual-report locate/fetch (Context Studio fast-path when ingested)
 *   enquiry → finance enquiry engine (root cause / projection / liquidity)
 *   data    → answer from the connected data source
 *   pptx    → client-side conversion; the server only returns guidance
 *   context → returns null — caller sends the message to Context Studio MCP
 */

import { callTool, extractText, getConfig } from './contextStudio.js';
import { answerFromDataContext, DataContextShape } from './dataAnswer.js';
import { answerEnquiry, detectEnquiry } from './enquiry.js';
import {
  detectReportIntent, searchAnnualReport,
  type ReportAlreadyIngested, type ReportSearchResult
} from './reportSearch.js';
import { SkillInvocation } from './skills.js';
import { webSearch } from './webSearch.js';

export interface SkillResult {
  reply: string;
  tool: string;
  isError: boolean;
  reportUrl?: string;
  reportFullText?: string;
}

function formatWebResult(result: Awaited<ReturnType<typeof webSearch>>): SkillResult {
  const snippetLines = result.snippets.slice(0, 5).map((s, i) => `**${i + 1}. [${s.title}](${s.url})**\n${s.snippet}`);
  const reply = [
    `## 🔍 ${result.title}`,
    '',
    ...(snippetLines.length ? ['**Top results:**', '', ...snippetLines, ''] : []),
    result.excerpt.slice(0, 2500),
    '',
    `**Source:** [${result.url}](${result.url})`
  ].filter(Boolean).join('\n');
  return { reply, tool: 'web-search', isError: !result.fetched, reportUrl: result.url, reportFullText: result.fullText };
}

/** Execute a skill invocation. Returns null when the skill routes to Context Studio. */
export async function runSkill(invocation: SkillInvocation, dataContext?: DataContextShape): Promise<SkillResult | null> {
  const query = invocation.query || invocation.message;

  switch (invocation.route) {
    case 'web': {
      const searchQuery =
        invocation.skill === 'industry-search' && !/industry|market/i.test(query) ? `${query} industry market size outlook`
        : invocation.skill === 'earnings-peer-comparison' && !/earnings|results|revenue/i.test(query) ? `${query} latest earnings results comparison`
        : query;
      return formatWebResult(await webSearch(searchQuery));
    }

    case 'report': {
      const intent = detectReportIntent(query) ?? detectReportIntent(`${query} annual report`);
      if (!intent) {
        // Could not extract a company — fall back to a web search for the report
        return formatWebResult(await webSearch(`${query} annual report`));
      }
      const result = await searchAnnualReport(intent.company, intent.year);

      // Already ingested in Context Studio — query the knowledge base instead
      if ((result as ReportAlreadyIngested).ingested) {
        const ingested = result as ReportAlreadyIngested;
        const config = getConfig();
        if (config.url) {
          const csResult = await callTool('context-broker-hybrid-query', {
            context_id: config.contextId,
            AgentPersona: config.agentPersona,
            query: ingested.contextStudioQuery
          });
          return { reply: extractText(csResult), tool: 'context-broker-hybrid-query', isError: csResult.isError ?? false };
        }
      }

      const r = result as ReportSearchResult;
      const cleanExcerpt = r.excerpt.replace(/\f/g, '\n\n').replace(/[ \t]{3,}/g, '  ').replace(/\n{4,}/g, '\n\n\n').trim();
      const reply = [
        `## ${r.title}`,
        '',
        r.fetched ? `✅ Read **${r.title}**${r.pages > 0 ? ` · ${r.pages} pages` : ''}:` : `🔍 Searched the web for **${r.title}**:`,
        '',
        cleanExcerpt || '_(No content could be extracted)_',
        '',
        `**Source:** [${r.url}](${r.url})`
      ].join('\n');
      return { reply, tool: 'report-search', isError: !r.fetched, reportUrl: r.url, reportFullText: r.fullText };
    }

    case 'enquiry': {
      const kind = detectEnquiry(query) ?? 'rootCause';
      const answer = await answerEnquiry(query || invocation.message, kind);
      return { reply: answer.reply, tool: answer.tool, isError: false };
    }

    case 'data': {
      if (dataContext?.rows?.length) {
        return { reply: answerFromDataContext(query || 'summarize this document', dataContext), tool: 'data-grounded', isError: false };
      }
      return {
        reply: `The **${invocation.skill}** skill reads a connected document or dataset — nothing is loaded yet.\n\nUpload a file (📤 Upload file) or connect a source first, then re-run:\n\`@${invocation.skill} ${query || 'summarize the document'}\``,
        tool: invocation.skill,
        isError: true
      };
    }

    case 'pptx':
      return {
        reply: 'The **file-to-pptx** skill converts an attached file into an editable, downloadable PowerPoint.\n\nDrop a file (image, PDF, Excel, CSV, MD…) into the upload zone first, then run `@file-to-pptx` — the deck download button appears right here in the chat.',
        tool: 'file-to-pptx',
        isError: true
      };

    case 'context':
    default:
      return null;
  }
}
