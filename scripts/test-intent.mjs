// Quick test of detectReportIntent against skill message strings
const withYear = /\b([A-Za-z][A-Za-z0-9\s&.,\-]{1,40}?)\s+(?:FY\s*)?(\d{4})\s+(?:annual\s+)?(?:report|10-K|10K|results|filing|earnings)\b/i;
const yearFirst = /\b(?:FY\s*)?(\d{4})\s+(?:annual\s+)?(?:report|10-K|results|filing)\s+(?:for\s+)?([A-Za-z][A-Za-z0-9\s&.,\-]{1,40}?)\b/i;
const noYear = /\b(?:annual\s+report|10-K|latest\s+report)\s+(?:for\s+|of\s+)?([A-Za-z][A-Za-z0-9\s&.,\-]{1,40}?)(?:\s*$|[.,!?])/i;
const companyFirst = /\b([A-Za-z][A-Za-z0-9\s&.,\-]{1,30}?)\s+(?:annual\s+report|latest\s+report|10-K)\b/i;

function detect(msg) {
  let m = msg.match(withYear); if (m) return { pattern: 'withYear', company: m[1].trim(), year: m[2].trim() };
  m = msg.match(yearFirst); if (m) return { pattern: 'yearFirst', company: m[2].trim(), year: m[1].trim() };
  m = msg.match(noYear); if (m) return { pattern: 'noYear', company: m[1].trim() };
  m = msg.match(companyFirst); if (m) return { pattern: 'companyFirst', company: m[1].trim() };
  return null;
}

const tests = [
  "@annual-report-search IBM 2024",
  "Use the annual-report-search skill: IBM 2024",
  "@annual-report-analyzer IBM FY2025",
  "Use the annual-report-analyzer skill: IBM FY2025",
  "Use the annual-report-analyzer skill. What is IBM revenue?",
  "@pdf-file-reader What steps do you follow?",
  "@web-search IBM watsonx revenue 2025",
];

for (const msg of tests) {
  console.log(JSON.stringify(msg.slice(0, 70)).padEnd(75), '->', JSON.stringify(detect(msg)));
}
