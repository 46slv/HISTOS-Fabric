import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { runSuite, validateRelativePath } from './lexical-baseline.mjs';
import { measureExternalization } from './externalization-measure.mjs';

const REPORT_SCHEMA = 'histos.benchmark-externalization-report/v0';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function chooseProbe(caseReport) {
  for (const fragment of caseReport.selection.fragments) {
    const lines = String(fragment.text).split(/\r?\n/);
    for (const matchedLine of fragment.matched_lines ?? []) {
      const offset = matchedLine - fragment.start_line;
      if (offset < 0 || offset >= lines.length) continue;
      const probe = lines[offset].trim();
      if (probe.length >= 2) return probe;
    }
  }
  return null;
}

async function buildCorpusPayload({ suiteDir, item, caseReport }) {
  const realSuiteDir = await realpath(suiteDir);
  const reportByPath = new Map(caseReport.corpus.map((entry) => [entry.path, entry]));
  const chunks = [];

  for (const relativePath of item.corpus) {
    const normalized = validateRelativePath(relativePath);
    const reportEntry = reportByPath.get(normalized);
    if (!reportEntry) throw new Error(`REPORT_CORPUS_MISMATCH: missing ${normalized}`);

    const absolute = path.resolve(suiteDir, normalized);
    const resolved = await realpath(absolute);
    const relative = path.relative(realSuiteDir, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`INVALID_CORPUS_PATH: escaped suite directory after realpath: ${normalized}`);
    }

    const bytes = await readFile(resolved);
    if (bytes.byteLength !== reportEntry.bytes || sha256(bytes) !== reportEntry.sha256) {
      throw new Error(`SOURCE_MOVED: ${normalized} no longer matches lexical report identity`);
    }
    chunks.push(Buffer.from(`--- ${normalized} sha256=${reportEntry.sha256} ---\n`, 'utf8'));
    chunks.push(bytes);
    if (bytes.byteLength === 0 || bytes.at(-1) !== 0x0a) chunks.push(Buffer.from('\n', 'utf8'));
  }

  return Buffer.concat(chunks);
}

function aggregateExternalization(caseReports) {
  const measured = caseReports.filter((entry) => entry.externalization.status === 'MEASURED');
  const baseline = measured.reduce((sum, entry) => sum + entry.externalization.measurement.baseline_active_bytes, 0);
  const active = measured.reduce((sum, entry) => sum + entry.externalization.measurement.externalized_active_bytes, 0);
  return {
    measured_cases: measured.length,
    correctness_preserved_cases: measured.filter((entry) => entry.externalization.measurement.correctness_preserved).length,
    baseline_active_bytes: baseline,
    externalized_active_bytes: active,
    reduction_bytes: baseline - active,
    reduction_ratio: baseline === 0 ? null : 1 - active / baseline,
  };
}

export async function attachExternalizationMetrics({
  suitePath,
  lexicalReport,
  storeRoot,
  thresholdBytes = 256,
  previewBytes = 64,
  measureExternalizationFn = measureExternalization,
}) {
  const absoluteSuitePath = path.resolve(suitePath);
  const suiteDir = path.dirname(absoluteSuitePath);
  const suite = JSON.parse(await readFile(absoluteSuitePath, 'utf8'));
  const itemsById = new Map(suite.cases.map((item) => [item.id, item]));
  const reports = [];

  for (const profileReport of lexicalReport.reports) {
    const cases = [];
    for (const caseReport of profileReport.cases) {
      const item = itemsById.get(caseReport.case_id);
      if (!item) throw new Error(`REPORT_CASE_MISMATCH: unknown case ${caseReport.case_id}`);
      const probe = chooseProbe(caseReport);
      if (probe === null) {
        cases.push({
          ...caseReport,
          externalization: {
            status: 'NOT_APPLICABLE_EMPTY_SELECTION',
            reason: 'lexical baseline selected no fragment to verify through reopen',
          },
        });
        continue;
      }

      const payload = await buildCorpusPayload({ suiteDir, item, caseReport });
      const measurement = await measureExternalizationFn({
        root: storeRoot,
        payload,
        query: probe,
        thresholdBytes,
        previewBytes,
      });
      cases.push({
        ...caseReport,
        externalization: {
          status: 'MEASURED',
          probe,
          corpus_payload_bytes: payload.byteLength,
          measurement,
        },
      });
    }

    reports.push({
      ...profileReport,
      cases,
      externalization_aggregate: aggregateExternalization(cases),
    });
  }

  return {
    schema: REPORT_SCHEMA,
    suite_id: lexicalReport.suite_id,
    lexical_schema: lexicalReport.schema,
    measurement_semantics: {
      baseline: 'whole allowed corpus serialized as one deterministic payload per case',
      externalized: 'application-level externalize + literal search + exact reopen response bytes',
      verification_probe_source: 'first matched line from the lexical baseline selection; gold labels do not choose the probe',
      tokenizer_metric: 'NOT_IMPLEMENTED',
    },
    scoring: lexicalReport.scoring,
    reports,
  };
}

export async function runBenchmarkWithExternalization(suitePath, {
  profileId = null,
  storeRoot,
  thresholdBytes = 256,
  previewBytes = 64,
  runSuiteFn = runSuite,
  measureExternalizationFn = measureExternalization,
} = {}) {
  if (typeof storeRoot !== 'string' || storeRoot.length === 0) throw new Error('store_root required');
  const lexicalReport = await runSuiteFn(suitePath, { profileId });
  return attachExternalizationMetrics({
    suitePath,
    lexicalReport,
    storeRoot,
    thresholdBytes,
    previewBytes,
    measureExternalizationFn,
  });
}
