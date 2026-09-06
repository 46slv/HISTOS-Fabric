import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUITE_SCHEMA = 'histos.benchmark-suite/v0';
const REPORT_SCHEMA = 'histos.lexical-baseline-report/v0';
const DEFAULT_CONTEXT_LINES = 2;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function tokenize(text) {
  const normalized = String(text).normalize('NFKC').toLowerCase();
  return normalized.match(/[\p{L}\p{N}_$]+/gu) ?? [];
}

function unique(values) {
  return [...new Set(values)];
}

function canonicalSnapshotDigest(entries) {
  const payload = entries
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => `${entry.path}\0${entry.sha256}\0${entry.bytes}`)
    .join('\n');
  return sha256(Buffer.from(payload, 'utf8'));
}

export function validateRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('INVALID_CORPUS_PATH: path must be a non-empty string');
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`INVALID_CORPUS_PATH: absolute path refused: ${relativePath}`);
  }

  const normalized = relativePath.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..')) {
    throw new Error(`INVALID_CORPUS_PATH: parent traversal refused: ${relativePath}`);
  }
  if (parts.some((part) => part === '')) {
    throw new Error(`INVALID_CORPUS_PATH: empty path segment refused: ${relativePath}`);
  }
  return normalized;
}

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function validateSuite(suite) {
  if (!suite || typeof suite !== 'object') {
    throw new Error('INVALID_SUITE: expected object');
  }
  if (suite.schema !== SUITE_SCHEMA) {
    throw new Error(`INVALID_SUITE_SCHEMA: expected ${SUITE_SCHEMA}`);
  }
  if (typeof suite.suite_id !== 'string' || suite.suite_id.length === 0) {
    throw new Error('INVALID_SUITE: suite_id required');
  }
  if (!Array.isArray(suite.profiles) || suite.profiles.length === 0) {
    throw new Error('INVALID_SUITE: profiles required');
  }
  const profileIds = new Set();
  for (const profile of suite.profiles) {
    if (!profile || typeof profile.id !== 'string' || profile.id.length === 0) {
      throw new Error('INVALID_SUITE: profile id required');
    }
    if (profileIds.has(profile.id)) {
      throw new Error(`INVALID_SUITE: duplicate profile id ${profile.id}`);
    }
    profileIds.add(profile.id);
    assertPositiveInteger(profile.max_bytes, `profile ${profile.id} max_bytes`);
  }

  if (!Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error('INVALID_SUITE: cases required');
  }
  const caseIds = new Set();
  for (const item of suite.cases) {
    if (!item || typeof item.id !== 'string' || item.id.length === 0) {
      throw new Error('INVALID_SUITE: case id required');
    }
    if (caseIds.has(item.id)) {
      throw new Error(`INVALID_SUITE: duplicate case id ${item.id}`);
    }
    caseIds.add(item.id);
    if (typeof item.query !== 'string' || item.query.trim().length === 0) {
      throw new Error(`INVALID_SUITE: query required for ${item.id}`);
    }
    if (!Array.isArray(item.corpus) || item.corpus.length === 0) {
      throw new Error(`INVALID_SUITE: corpus required for ${item.id}`);
    }
    const paths = new Set();
    for (const corpusPath of item.corpus) {
      const normalized = validateRelativePath(corpusPath);
      if (paths.has(normalized)) {
        throw new Error(`INVALID_SUITE: duplicate corpus path ${normalized} in ${item.id}`);
      }
      paths.add(normalized);
    }

    if (!Array.isArray(item.required_evidence_groups)) {
      throw new Error(`INVALID_SUITE: required_evidence_groups must be an array for ${item.id}`);
    }
    const groupIds = new Set();
    for (const group of item.required_evidence_groups) {
      if (!group || typeof group.id !== 'string' || group.id.length === 0) {
        throw new Error(`INVALID_SUITE: evidence group id required for ${item.id}`);
      }
      if (groupIds.has(group.id)) {
        throw new Error(`INVALID_SUITE: duplicate evidence group ${group.id} in ${item.id}`);
      }
      groupIds.add(group.id);
      if (!Array.isArray(group.ranges) || group.ranges.length === 0) {
        throw new Error(`INVALID_SUITE: evidence ranges required for ${item.id}/${group.id}`);
      }
      for (const range of group.ranges) {
        const normalized = validateRelativePath(range.path);
        if (!paths.has(normalized)) {
          throw new Error(`INVALID_SUITE: evidence path ${normalized} not in corpus for ${item.id}`);
        }
        assertPositiveInteger(range.start_line, `evidence ${item.id}/${group.id} start_line`);
        assertPositiveInteger(range.end_line, `evidence ${item.id}/${group.id} end_line`);
        if (range.end_line < range.start_line) {
          throw new Error(`INVALID_SUITE: evidence end before start for ${item.id}/${group.id}`);
        }
      }
    }
    if (item.expect_no_answer === true && item.required_evidence_groups.length !== 0) {
      throw new Error(`INVALID_SUITE: no-answer case ${item.id} cannot require evidence groups`);
    }
  }
  return suite;
}

function scoreLine(line, queryTokens) {
  const lineTokens = new Set(tokenize(line));
  let exactHits = 0;
  for (const token of queryTokens) {
    if (lineTokens.has(token)) exactHits += 1;
  }
  if (exactHits === 0) return 0;
  return exactHits * 100 + Math.min(line.length, 200) / 200;
}

function buildWindows(lines, queryTokens, contextLines = DEFAULT_CONTEXT_LINES) {
  const hits = [];
  for (let index = 0; index < lines.length; index += 1) {
    const score = scoreLine(lines[index], queryTokens);
    if (score > 0) hits.push({ line: index + 1, score });
  }
  if (hits.length === 0) return [];

  const intervals = hits
    .map((hit) => ({
      start: Math.max(1, hit.line - contextLines),
      end: Math.min(lines.length, hit.line + contextLines),
      score: hit.score,
      matched_lines: [hit.line],
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged = [];
  for (const interval of intervals) {
    const prior = merged.at(-1);
    if (prior && interval.start <= prior.end + 1) {
      prior.end = Math.max(prior.end, interval.end);
      prior.score += interval.score;
      prior.matched_lines.push(...interval.matched_lines);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function renderFragment(fragment) {
  const header = `--- ${fragment.path}:${fragment.start_line}-${fragment.end_line} sha256=${fragment.source_sha256} ---\n`;
  const body = fragment.text.endsWith('\n') ? fragment.text : `${fragment.text}\n`;
  return `${header}${body}`;
}

function rangeOverlaps(fragment, range) {
  return fragment.path === range.path && fragment.start_line <= range.end_line && fragment.end_line >= range.start_line;
}

function fragmentIsGold(fragment, groups) {
  return groups.some((group) => group.ranges.some((range) => rangeOverlaps(fragment, range)));
}

function evaluateEvidenceGroups(fragments, groups) {
  const detail = groups.map((group) => ({
    id: group.id,
    hit: group.ranges.some((range) => fragments.some((fragment) => rangeOverlaps(fragment, range))),
  }));
  const hit = detail.filter((entry) => entry.hit).length;
  return {
    total: detail.length,
    hit,
    recall: detail.length === 0 ? null : hit / detail.length,
    detail,
  };
}

async function loadCorpus(suiteDir, corpusPaths) {
  const entries = [];
  const realSuiteDir = await realpath(suiteDir);
  for (const relativePath of corpusPaths) {
    const normalized = validateRelativePath(relativePath);
    const absolute = path.resolve(suiteDir, normalized);
    const expectedPrefix = `${realSuiteDir}${path.sep}`;
    const realAbsolute = await realpath(absolute);
    if (!realAbsolute.startsWith(expectedPrefix)) {
      throw new Error(`INVALID_CORPUS_PATH: escaped suite directory after realpath: ${relativePath}`);
    }
    const bytes = await readFile(realAbsolute);
    const text = bytes.toString('utf8');
    entries.push({
      path: normalized,
      absolute: realAbsolute,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
      text,
      lines: text.split(/\r?\n/),
    });
  }
  return entries;
}

function selectFragments(corpus, query, maxBytes) {
  const queryTokens = unique(tokenize(query)).filter((token) => token.length >= 2);
  const candidates = [];
  for (const source of corpus) {
    const windows = buildWindows(source.lines, queryTokens);
    for (const window of windows) {
      const text = source.lines.slice(window.start - 1, window.end).join('\n');
      const fragment = {
        path: source.path,
        start_line: window.start,
        end_line: window.end,
        matched_lines: unique(window.matched_lines).sort((a, b) => a - b),
        score: Number(window.score.toFixed(3)),
        source_sha256: source.sha256,
        text,
      };
      fragment.rendered = renderFragment(fragment);
      fragment.rendered_bytes = Buffer.byteLength(fragment.rendered, 'utf8');
      candidates.push(fragment);
    }
  }

  candidates.sort((a, b) =>
    b.score - a.score ||
    a.path.localeCompare(b.path) ||
    a.start_line - b.start_line,
  );

  const selected = [];
  let renderedBytes = 0;
  for (const candidate of candidates) {
    if (renderedBytes + candidate.rendered_bytes > maxBytes) continue;
    selected.push(candidate);
    renderedBytes += candidate.rendered_bytes;
  }
  return { queryTokens, candidates, selected, renderedBytes };
}

function summarizeCase({ suite, item, profile, corpus, selection }) {
  const evidence = evaluateEvidenceGroups(selection.selected, item.required_evidence_groups);
  const selectedWithGold = selection.selected.map((fragment) => ({
    ...fragment,
    gold_overlap: fragmentIsGold(fragment, item.required_evidence_groups),
  }));
  const goldSelected = selectedWithGold.filter((fragment) => fragment.gold_overlap).length;
  const selectedCount = selection.selected.length;
  const noAnswerPass = item.expect_no_answer === true ? selectedCount === 0 : null;

  return {
    case_id: item.id,
    query: item.query,
    expect_no_answer: item.expect_no_answer === true,
    profile: profile.id,
    max_bytes: profile.max_bytes,
    snapshot_digest: canonicalSnapshotDigest(corpus),
    corpus: corpus.map((entry) => ({ path: entry.path, sha256: entry.sha256, bytes: entry.bytes })),
    selection: {
      rendered_bytes: selection.renderedBytes,
      fragments: selectedWithGold.map(({ rendered, ...fragment }) => fragment),
    },
    metrics: {
      required_evidence_groups_total: evidence.total,
      required_evidence_groups_hit: evidence.hit,
      required_evidence_group_recall: evidence.recall,
      evidence_group_detail: evidence.detail,
      selected_fragments: selectedCount,
      selected_fragment_gold_precision: selectedCount === 0 ? null : goldSelected / selectedCount,
      corpus_files_scanned: corpus.length,
      corpus_bytes_scanned: corpus.reduce((sum, entry) => sum + entry.bytes, 0),
      raw_source_bytes_exposed: selection.selected.reduce((sum, fragment) => sum + Buffer.byteLength(fragment.text, 'utf8'), 0),
      exact_reopen_coordinates: selection.selected.every((fragment) => Number.isInteger(fragment.start_line) && Number.isInteger(fragment.end_line) && fragment.source_sha256.length === 64),
      expected_no_answer_pass: noAnswerPass,
    },
  };
}

function aggregateReports(caseReports) {
  const evidenceReports = caseReports.filter((report) => report.metrics.required_evidence_groups_total > 0);
  const noAnswerReports = caseReports.filter((report) => report.expect_no_answer);
  const evidenceTotal = evidenceReports.reduce((sum, report) => sum + report.metrics.required_evidence_groups_total, 0);
  const evidenceHit = evidenceReports.reduce((sum, report) => sum + report.metrics.required_evidence_groups_hit, 0);
  const selectedTotal = caseReports.reduce((sum, report) => sum + report.metrics.selected_fragments, 0);
  const selectedGold = caseReports.reduce((sum, report) => {
    return sum + report.selection.fragments.filter((fragment) => fragment.gold_overlap).length;
  }, 0);

  return {
    required_evidence_groups_total: evidenceTotal,
    required_evidence_groups_hit: evidenceHit,
    required_evidence_group_recall: evidenceTotal === 0 ? null : evidenceHit / evidenceTotal,
    selected_fragments: selectedTotal,
    selected_fragment_gold_precision: selectedTotal === 0 ? null : selectedGold / selectedTotal,
    raw_source_bytes_exposed: caseReports.reduce((sum, report) => sum + report.metrics.raw_source_bytes_exposed, 0),
    rendered_bytes: caseReports.reduce((sum, report) => sum + report.selection.rendered_bytes, 0),
    no_answer_cases_total: noAnswerReports.length,
    no_answer_cases_pass: noAnswerReports.filter((report) => report.metrics.expected_no_answer_pass === true).length,
  };
}

export async function runSuite(suitePath, { profileId = null } = {}) {
  const absoluteSuitePath = path.resolve(suitePath);
  const suiteDir = path.dirname(absoluteSuitePath);
  const suite = validateSuite(JSON.parse(await readFile(absoluteSuitePath, 'utf8')));
  const profiles = profileId === null
    ? suite.profiles
    : suite.profiles.filter((profile) => profile.id === profileId);
  if (profiles.length === 0) {
    throw new Error(`UNKNOWN_PROFILE: ${profileId}`);
  }

  const reports = [];
  for (const profile of profiles) {
    const caseReports = [];
    for (const item of suite.cases) {
      const corpus = await loadCorpus(suiteDir, item.corpus);
      const selection = selectFragments(corpus, item.query, profile.max_bytes);
      caseReports.push(summarizeCase({ suite, item, profile, corpus, selection }));
    }
    reports.push({
      profile: profile.id,
      max_bytes: profile.max_bytes,
      cases: caseReports,
      aggregate: aggregateReports(caseReports),
    });
  }

  return {
    schema: REPORT_SCHEMA,
    suite_schema: suite.schema,
    suite_id: suite.suite_id,
    scoring: {
      kind: 'deterministic-lexical-line-window/v0',
      context_lines: DEFAULT_CONTEXT_LINES,
      budget_unit: 'utf8_rendered_bytes',
      token_metric: 'NOT_IMPLEMENTED',
    },
    reports,
  };
}

async function main(argv) {
  const [suiteArg, ...rest] = argv;
  if (!suiteArg || rest.includes('--help')) {
    console.error('usage: node tools/bench/lexical-baseline.mjs <suite.json> [--profile <id>]');
    return suiteArg ? 0 : 2;
  }
  let profileId = null;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--profile') {
      profileId = rest[index + 1] ?? null;
      index += 1;
    } else {
      throw new Error(`UNKNOWN_ARGUMENT: ${rest[index]}`);
    }
  }
  if (rest.includes('--profile') && profileId === null) {
    throw new Error('MISSING_PROFILE_ID');
  }

  const result = await runSuite(suiteArg, { profileId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
