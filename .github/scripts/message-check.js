// Message check: enforces the message rules in AI_RULES.md section 7.
//
// - Pull requests: removes signature footers from the description, then fails
//   on tool names in the title or description, on a tool-named branch, and on
//   commits with signature lines, tool names or a tool identity.
// - Pushes: fails on a tool-named branch and on such commits.
// - Issues, comments and reviews: removes signature footers and fails when the
//   text names the conventions file.
//
// Runs from .github/workflows/message-check.yml. Tests: node --test .github/scripts/

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SIGNATURE_LINES = [
  // Co-authored-by trailers that name an assistant or its vendor.
  /^\s*co-authored-by:.*\b(claude|anthropic|openai|codex|copilot|chatgpt|gemini|cursor|devin)/i,
  // Tool trailers such as "Claude-Session: <link>".
  /^\s*(claude|codex|copilot|chatgpt|cursor)-[\w-]+:\s*\S+\s*$/i,
  // "Generated with/by <tool>" footers, with or without emoji and markup.
  /^[\W_]*generated\s+(with|by)\s+\[?(claude|codex|copilot|chatgpt|gemini)\b/iu,
  // A line that is only a link to an assistant session or app.
  /^[\s>*_`(<[]*https?:\/\/(www\.)?(claude\.ai|claude\.com|chatgpt\.com|chat\.openai\.com)\/\S*[\s)>\]*_`]*$/i,
  // Sign-offs such as "— Claude" or "-- Codex".
  /^\s*[-–—~]+\s*(claude|codex|copilot|chatgpt)(\s+code)?\s*\.?\s*$/i,
];

// Tool names as words, also inside branch refs such as "Tiwas/codex/x". A
// preceding "@" (the "@codex review" command) or "." (dot folders such as
// ".claude/") does not count. Links and file names ending in ".md" are
// reported by ASSISTANT_LINK and CONVENTIONS_FILE instead.
const TOOL_NAME = /(?<![@.\w-])(?<!\/\/)(claude|codex|chatgpt|copilot|gemini|anthropic|openai)(?!\w|\.md\b)|(?<![\w-])gpt-?\d/gi;
const ASSISTANT_LINK = /https?:\/\/(www\.)?(claude\.ai|claude\.com|chatgpt\.com|chat\.openai\.com)\b\S*/gi;
const CONVENTIONS_FILE = /(?<![\w.-])(claude|agents)\.md\b/gi;
const ASSISTANT_IDENTITY = /\b(claude|anthropic|openai|codex|copilot|chatgpt|gemini|cursor|devin)/i;
const ASSISTANT_BRANCH = /(?:^|[/_.-])(claude|codex|copilot|chatgpt|gemini|openai|anthropic|gpt)(?:[/_.-]|$)/i;
const HORIZONTAL_RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

export function isSignatureLine(line) {
  return SIGNATURE_LINES.some((pattern) => pattern.test(line));
}

/**
 * Removes signature lines. When something was removed, a horizontal rule and
 * blank lines left dangling at the end are removed too.
 * @returns {{ text: string, removed: string[] }}
 */
export function stripSignatures(text) {
  if (!text) return { text: text ?? '', removed: [] };
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const removed = [];
  const kept = text.split(/\r?\n/).filter((line) => {
    if (!isSignatureLine(line)) return true;
    removed.push(line.trim());
    return false;
  });
  if (removed.length === 0) return { text, removed };
  const trimEnd = () => {
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  };
  trimEnd();
  if (kept.length > 0 && HORIZONTAL_RULE.test(kept[kept.length - 1])) {
    kept.pop();
    trimEnd();
  }
  return { text: kept.join(eol), removed };
}

function uniqueMatches(text, pattern) {
  return [...new Set([...(text || '').matchAll(pattern)].map((match) => match[0]))];
}

/** Tool names, assistant links and conventions-file names in strict text (PRs, commits). */
export function findToolNames(text) {
  return [
    ...uniqueMatches(text, TOOL_NAME),
    ...uniqueMatches(text, ASSISTANT_LINK),
    ...uniqueMatches(text, CONVENTIONS_FILE),
  ];
}

/** Conventions-file names and assistant links in comments and issues. */
export function findReferences(text) {
  return [...uniqueMatches(text, CONVENTIONS_FILE), ...uniqueMatches(text, ASSISTANT_LINK)];
}

export function isAssistantIdentity(name, email) {
  return ASSISTANT_IDENTITY.test(`${name} <${email}>`);
}

export function isAssistantBranch(branch) {
  return ASSISTANT_BRANCH.test(branch || '');
}

/** Problems in one commit: signature lines, tool names and tool identities. */
export function checkCommit(commit) {
  const short = commit.sha.slice(0, 7);
  const problems = [];
  const signatures = commit.message.split(/\r?\n/).filter(isSignatureLine);
  if (signatures.length > 0) problems.push(`commit ${short}: signature line "${signatures[0].trim()}"`);
  const names = findToolNames(commit.message);
  if (names.length > 0) problems.push(`commit ${short}: message names ${names.join(', ')}`);
  if (isAssistantIdentity(commit.authorName, commit.authorEmail)) {
    problems.push(`commit ${short}: author ${commit.authorName} <${commit.authorEmail}>`);
  }
  if (isAssistantIdentity(commit.committerName, commit.committerEmail)) {
    problems.push(`commit ${short}: committer ${commit.committerName} <${commit.committerEmail}>`);
  }
  return problems;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function commitExists(sha) {
  try {
    git(['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** Reads the commits of a git log range (for example ["base..head"]). */
export function readCommits(range) {
  const output = git(['log', '-z', '--format=%H%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%B', ...range]);
  return output.split('\0').filter(Boolean).map((record) => {
    const [sha, authorName, authorEmail, committerName, committerEmail, message] = record.split('\x1f');
    return { sha, authorName, authorEmail, committerName, committerEmail, message: message || '' };
  });
}

function makeApi(token, apiUrl) {
  return async (method, path, body) => {
    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
}

/**
 * Removes signature footers from a text and saves it through `save`.
 * Records a fix, or a problem when saving is impossible or fails. Returns the
 * text without signatures, so later checks do not report them a second time.
 */
async function cleanText(label, text, save, result, { allowEmpty }) {
  const { text: cleaned, removed } = stripSignatures(text);
  if (removed.length === 0) return text;
  if (!allowEmpty && cleaned.trim() === '') {
    result.problems.push(`${label} contains only a signature; delete it`);
    return cleaned;
  }
  try {
    await save(cleaned);
    result.fixes.push(`${label}: removed ${removed.map((line) => `"${line}"`).join(', ')}`);
  } catch (error) {
    result.problems.push(`${label}: signature found but not removed (${error.message})`);
  }
  return cleaned;
}

function checkBranch(branch, result) {
  if (isAssistantBranch(branch)) result.problems.push(`branch "${branch}" is named after a tool`);
}

function checkCommits(commits, result) {
  for (const commit of commits) result.problems.push(...checkCommit(commit));
}

async function handlePullRequest(context, result) {
  const { event, repo, api, readCommits: read } = context;
  const pr = event.pull_request;
  const label = `PR #${pr.number} description`;
  const body = await cleanText(label, pr.body || '', (text) => api('PATCH', `/repos/${repo}/pulls/${pr.number}`, { body: text }), result, { allowEmpty: true });
  const titleNames = findToolNames(pr.title);
  if (titleNames.length > 0) result.problems.push(`PR #${pr.number} title names ${titleNames.join(', ')}`);
  const bodyNames = findToolNames(body);
  if (bodyNames.length > 0) result.problems.push(`${label} names ${bodyNames.join(', ')}`);
  checkBranch(pr.head.ref, result);
  checkCommits(read([`${pr.base.sha}..${pr.head.sha}`]), result);
}

async function handlePush(context, result) {
  const { event, readCommits: read, commitExists: exists } = context;
  if (event.deleted || !event.ref.startsWith('refs/heads/')) return;
  const branch = event.ref.slice('refs/heads/'.length);
  const defaultBranch = event.repository.default_branch;
  checkBranch(branch, result);
  let range;
  if (!/^0+$/.test(event.before) && exists(event.before)) {
    range = [`${event.before}..${event.after}`];
  } else if (branch !== defaultBranch && exists(`origin/${defaultBranch}`)) {
    range = [`origin/${defaultBranch}..${event.after}`];
  } else {
    range = ['-1', event.after];
  }
  checkCommits(read(range), result);
}

async function handleText(context, result, { label, text, save, allowEmpty, author }) {
  if (!text || author?.type === 'Bot') return;
  const cleaned = await cleanText(label, text, save, result, { allowEmpty });
  const references = findReferences(cleaned);
  if (references.length > 0) result.problems.push(`${label} names ${references.join(', ')}`);
}

const HANDLERS = {
  pull_request: handlePullRequest,
  push: handlePush,
  issues: (context, result) => {
    const { issue } = context.event;
    const path = `/repos/${context.repo}/issues/${issue.number}`;
    return handleText(context, result, {
      label: `issue #${issue.number}`,
      text: issue.body,
      save: (body) => context.api('PATCH', path, { body }),
      allowEmpty: true,
      author: issue.user,
    });
  },
  issue_comment: (context, result) => {
    const { comment, issue } = context.event;
    return handleText(context, result, {
      label: `comment ${comment.id} on #${issue.number}`,
      text: comment.body,
      save: (body) => context.api('PATCH', `/repos/${context.repo}/issues/comments/${comment.id}`, { body }),
      allowEmpty: false,
      author: comment.user,
    });
  },
  pull_request_review_comment: (context, result) => {
    const { comment, pull_request: pr } = context.event;
    return handleText(context, result, {
      label: `review comment ${comment.id} on #${pr.number}`,
      text: comment.body,
      save: (body) => context.api('PATCH', `/repos/${context.repo}/pulls/comments/${comment.id}`, { body }),
      allowEmpty: false,
      author: comment.user,
    });
  },
  pull_request_review: (context, result) => {
    const { review, pull_request: pr } = context.event;
    return handleText(context, result, {
      label: `review ${review.id} on #${pr.number}`,
      text: review.body,
      save: (body) => context.api('PUT', `/repos/${context.repo}/pulls/${pr.number}/reviews/${review.id}`, { body }),
      allowEmpty: false,
      author: review.user,
    });
  },
};

/** Runs the check for one event. Returns the fixes made and the problems found. */
export async function run(context) {
  const result = { fixes: [], problems: [] };
  const handler = HANDLERS[context.eventName];
  if (handler) await handler(context, result);
  return result;
}

// Escapes text for a workflow command so it cannot start a new command.
function escapeCommandData(text) {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function report(result) {
  for (const fix of result.fixes) console.log(`::notice::${escapeCommandData(fix)}`);
  for (const problem of result.problems) console.log(`::error::${escapeCommandData(problem)}`);
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  const lines = ['## Message check', ''];
  if (result.fixes.length === 0 && result.problems.length === 0) lines.push('No findings.');
  for (const fix of result.fixes) lines.push(`- Fixed: ${fix}`);
  for (const problem of result.problems) lines.push(`- Problem: ${problem}`);
  appendFileSync(summaryFile, `${lines.join('\n')}\n`);
}

async function main() {
  const result = await run({
    eventName: process.env.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    repo: process.env.GITHUB_REPOSITORY,
    api: makeApi(process.env.GITHUB_TOKEN, process.env.GITHUB_API_URL || 'https://api.github.com'),
    readCommits,
    commitExists,
  });
  report(result);
  if (result.problems.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.log(`::error::${escapeCommandData(error.message)}`);
    process.exitCode = 1;
  });
}
