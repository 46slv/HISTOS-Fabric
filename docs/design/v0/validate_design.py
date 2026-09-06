"""Offline shape/link checks for design artifacts, NOT HISTOS runtime tests.

Requires Python 3 and jsonschema. Run from any directory. No network or writes.
For a partial export, --known-paths accepts a JSON array of paths independently
confirmed in the baseline Git tree; normal repository checkouts do not need it.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import posixpath
import re
from pathlib import Path

from jsonschema import Draft202012Validator


def check(known_paths_file: Path | None = None) -> dict:
    here = Path(__file__).resolve().parent
    root = here.parents[2]
    schema = json.loads((here / 'contracts.schema.json').read_text(encoding='utf-8'))
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema)
    fixture = json.loads((here / 'contract-examples.json').read_text(encoding='utf-8'))
    examples = fixture['cases']
    if len({x['id'] for x in examples}) != len(examples):
        raise ValueError('Duplicate shape fixture IDs')
    for example in examples:
        observed = validator.is_valid(example['message'])
        if observed != example['expected_valid']:
            raise ValueError(f"Unexpected shape result: {example['id']}")
    source_digest = 'sha256:' + hashlib.sha256(
        fixture['synthetic_source_bytes_utf8'].encode('utf-8')
    ).hexdigest()
    for example in examples:
        if example['expected_valid']:
            for item in example['message'].get('items', []):
                if item['source_digest'] != source_digest:
                    raise ValueError('Synthetic source digest mismatch')
    cases = json.loads((here / 'conformance-cases.json').read_text(encoding='utf-8'))['cases']
    expected_ids = {
        f'{prefix}{n:02d}' for prefix, count in [('C', 8), ('D', 8), ('S', 8), ('M', 6), ('I', 4)]
        for n in range(1, count + 1)
    }
    if len(cases) != len(expected_ids) or {c['id'] for c in cases} != expected_ids:
        raise ValueError('Runtime specification case ID mismatch')
    if any(c['status'] != 'NOT_RUN' or not re.fullmatch(r'H[0-9]', c['slice']) for c in cases):
        raise ValueError('Runtime specifications must remain NOT_RUN and name a slice')
    known = set()
    if known_paths_file is not None:
        known = set(json.loads(known_paths_file.read_text(encoding='utf-8')))
    md_files = sorted(here.glob('*.md')) + [root / 'docs' / 'README.md']
    link_count = 0
    for path in md_files:
        text = path.read_text(encoding='utf-8')
        if sum(line.startswith('```') for line in text.splitlines()) % 2:
            raise ValueError(f'Unbalanced fenced blocks: {path.name}')
        for target in re.findall(r'(?<!!)\[[^\]]+\]\(([^)]+)\)', text):
            if target.startswith(('http://', 'https://', '#', 'mailto:')):
                continue
            target = target.split('#', 1)[0]
            relative = posixpath.normpath(
                posixpath.join(path.parent.relative_to(root).as_posix(), target)
            )
            if relative.startswith('../') or relative.startswith('/'):
                raise ValueError(f'Link escapes repository: {relative}')
            if not (root / relative).is_file() and relative not in known:
                raise ValueError(f'Missing relative link: {relative}')
            link_count += 1
    return {
        'status': 'STATIC_PASS_ONLY',
        'validator': 'jsonschema ' + importlib.metadata.version('jsonschema'),
        'schema_meta_validation': 'PASS',
        'shape_examples': len(examples),
        'expected_accepted': sum(e['expected_valid'] for e in examples),
        'expected_rejected': sum(not e['expected_valid'] for e in examples),
        'synthetic_source_digest': 'PASS',
        'runtime_case_specs': len(cases),
        'runtime_cases_executed': 0,
        'markdown_files': len(md_files),
        'relative_links_checked': link_count,
        'fence_balance': 'PASS',
        'baseline_path_manifest_used': known_paths_file is not None,
        'limitations': 'No authorization, runtime, tokenizer accuracy, crash, host or performance test.',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--known-paths', type=Path)
    args = parser.parse_args()
    print(json.dumps(check(args.known_paths), indent=2))
