import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseNonNegativeInteger(raw, label) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(raw ?? ''))) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(raw);
}

export function parseArgs(argv) {
  const options = {
    suitePath: null,
    storeRoot: null,
    reportPath: null,
    profileId: null,
    thresholdBytes: 256,
    previewBytes: 64,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--store' || arg === '--report' || arg === '--profile' || arg === '--threshold' || arg === '--preview') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--store') options.storeRoot = value;
      if (arg === '--report') options.reportPath = value;
      if (arg === '--profile') options.profileId = value;
      if (arg === '--threshold') options.thresholdBytes = parseNonNegativeInteger(value, 'threshold_bytes');
      if (arg === '--preview') options.previewBytes = parseNonNegativeInteger(value, 'preview_bytes');
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    if (options.suitePath !== null) throw new Error(`unexpected positional argument: ${arg}`);
    options.suitePath = arg;
  }

  if (!options.help) {
    if (options.suitePath === null) throw new Error('suite path required');
    if (options.storeRoot === null || options.storeRoot.length === 0) throw new Error('--store required');
    if (options.reportPath !== null && options.reportPath.length === 0) throw new Error('--report requires a non-empty value');
    if (options.profileId !== null && options.profileId.length === 0) throw new Error('--profile requires a non-empty value');
  }

  return Object.freeze(options);
}

function ratioOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function summarizeReport(report) {
  if (!report || report.schema !== 'histos.benchmark-externalization-report/v0' || !Array.isArray(report.reports)) {
    throw new Error('INVALID_REPORT: expected histos.benchmark-externalization-report/v0');
  }

  const profiles = report.reports.map((profileReport) => {
    const lexical = profileReport.aggregate ?? {};
    const externalization = profileReport.externalization_aggregate ?? {};
    const measuredCases = Number(externalization.measured_cases ?? 0);
    const preservedCases = Number(externalization.correctness_preserved_cases ?? 0);
    return Object.freeze({
      profile: profileReport.profile,
      max_bytes: profileReport.max_bytes,
      required_evidence_group_recall: ratioOrNull(lexical.required_evidence_group_recall),
      selected_fragment_gold_precision: ratioOrNull(lexical.selected_fragment_gold_precision),
      raw_source_bytes_exposed: Number(lexical.raw_source_bytes_exposed ?? 0),
      rendered_bytes: Number(lexical.rendered_bytes ?? 0),
      no_answer_cases_pass: Number(lexical.no_answer_cases_pass ?? 0),
      no_answer_cases_total: Number(lexical.no_answer_cases_total ?? 0),
      measured_cases: measuredCases,
      correctness_preserved_cases: preservedCases,
      externalization_correctness_pass: measuredCases === 0 ? null : preservedCases === measuredCases,
      baseline_active_bytes: Number(externalization.baseline_active_bytes ?? 0),
      externalized_active_bytes: Number(externalization.externalized_active_bytes ?? 0),
      reduction_bytes: Number(externalization.reduction_bytes ?? 0),
      reduction_ratio: ratioOrNull(externalization.reduction_ratio),
    });
  });

  const measuredProfiles = profiles.filter((profile) => profile.measured_cases > 0);
  return Object.freeze({
    schema: 'histos.benchmark-joint-summary/v0',
    suite_id: report.suite_id,
    tokenizer_metric: report.measurement_semantics?.tokenizer_metric ?? 'NOT_IMPLEMENTED',
    profiles,
    all_externalization_correctness_preserved:
      measuredProfiles.length === 0 ? null : measuredProfiles.every((profile) => profile.externalization_correctness_pass === true),
  });
}

export function buildEvidenceEnvelope(report, summary, options) {
  return Object.freeze({
    schema: 'histos.benchmark-joint-evidence/v0',
    suite_id: report.suite_id,
    execution_options: Object.freeze({
      profile: options.profileId,
      threshold_bytes: options.thresholdBytes,
      preview_bytes: options.previewBytes,
    }),
    report,
    summary,
  });
}

export async function publishEvidenceReport(reportPath, envelope) {
  const bytes = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  const directory = dirname(reportPath);
  await mkdir(directory, { recursive: true });
  const tempPath = `${reportPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await link(tempPath, reportPath);
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error(`REPORT_EXISTS: refusing to overwrite ${reportPath}`);
      throw error;
    }
  } finally {
    await rm(tempPath, { force: true });
  }
  return Object.freeze({
    path: reportPath,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

function formatScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(6);
  return String(value);
}

export function formatText(summary) {
  return summary.profiles.map((profile) => [
    `profile=${profile.profile}`,
    `max_bytes=${profile.max_bytes}`,
    `recall=${formatScalar(profile.required_evidence_group_recall)}`,
    `gold_precision=${formatScalar(profile.selected_fragment_gold_precision)}`,
    `raw_exposed=${profile.raw_source_bytes_exposed}`,
    `rendered=${profile.rendered_bytes}`,
    `no_answer=${profile.no_answer_cases_pass}/${profile.no_answer_cases_total}`,
    `externalized=${profile.correctness_preserved_cases}/${profile.measured_cases}`,
    `baseline_active=${profile.baseline_active_bytes}`,
    `externalized_active=${profile.externalized_active_bytes}`,
    `reduction=${profile.reduction_bytes}`,
    `reduction_ratio=${formatScalar(profile.reduction_ratio)}`,
  ].join(' ')).join('\n');
}

export async function main(argv, {
  run = null,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 2;
  }

  if (options.help) {
    stdout.write('usage: node tools/bench/benchmark-externalization-cli.mjs <suite.json> --store <dir> [--report <file>] [--profile <id>] [--threshold <bytes>] [--preview <bytes>] [--json]\n');
    return 0;
  }

  try {
    let runner = run;
    if (runner === null) {
      ({ runBenchmarkWithExternalization: runner } = await import('./benchmark-externalization.mjs'));
    }
    const report = await runner(options.suitePath, {
      profileId: options.profileId,
      storeRoot: options.storeRoot,
      thresholdBytes: options.thresholdBytes,
      previewBytes: options.previewBytes,
    });
    const summary = summarizeReport(report);
    if (options.reportPath !== null) {
      await publishEvidenceReport(options.reportPath, buildEvidenceEnvelope(report, summary, options));
    }
    stdout.write(options.json ? `${JSON.stringify(summary, null, 2)}\n` : `${formatText(summary)}\n`);
    return summary.all_externalization_correctness_preserved === false ? 1 : 0;
  } catch (error) {
    stderr.write(`${error.message}\n`);
    return 1;
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  process.exitCode = await main(process.argv.slice(2));
}
