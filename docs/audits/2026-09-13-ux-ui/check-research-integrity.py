#!/usr/bin/env python3
"""Check frozen source and package payloads, inventory IDs and derived index links."""
import csv
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse

RESEARCH = Path(__file__).resolve().parent
ROOT = RESEARCH.parents[2]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
source = json.loads((RESEARCH / 'candidate-source.json').read_text())
errors = []
for name, digest in source['sha256'].items():
    path = ROOT / name
    if not path.is_file() or sha(path) != digest:
        errors.append('source mismatch: ' + name)
packages = {}
for manifest in sorted(RESEARCH.glob('*/manifest.sha256')):
    count = 0
    for line in manifest.read_text().splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r'([a-f0-9]{64})\s+\*?(.+)', line)
        if not match:
            errors.append('malformed manifest: ' + str(manifest))
            continue
        digest, name = match.groups()
        path = ROOT / name if name.startswith('docs/') else manifest.parent / name
        if not path.is_file() or sha(path) != digest:
            errors.append('package mismatch: ' + str(path.relative_to(ROOT)))
        count += 1
    packages[manifest.parent.name] = dict(payloads=count, manifestSha256=sha(manifest))

counts = {}
for filename, key in [('requirement-coverage.csv', 'requirement'), ('finding-map.csv', 'finding')]:
    with (RESEARCH / filename).open() as stream:
        rows = list(csv.DictReader(stream))
    ids = [row[key] for row in rows]
    if len(ids) != len(set(ids)):
        errors.append('duplicate ID: ' + filename)
    counts[filename] = len(rows)
with (RESEARCH / 'coverage.csv').open() as stream:
    rows = list(csv.DictReader(stream))
counts['coverage.csv'] = len(rows)
scenario_ids = set(re.findall(r'^\| (SC-[A-Z]+\d+) \|', (RESEARCH / 'scenarios.md').read_text(), re.M))
for row in rows:
    if row['scenario'] not in scenario_ids:
        errors.append('unknown scenario: ' + row['scenario'])
    if not row['limitation']:
        errors.append('missing coverage limitation: ' + row['scenario'])

class Links(HTMLParser):
    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name not in ('href', 'src') or not value:
                continue
            parsed = urlparse(value)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            if not (RESEARCH / unquote(parsed.path)).exists():
                errors.append('index missing link: ' + value)

index = RESEARCH / 'review-index.html'
if index.exists():
    body = index.read_text()
    Links().feed(body)
    if sha(ROOT / 'docs/BACKLOG.md') not in body:
        errors.append('review index is stale relative to BACKLOG')
result = dict(sourceFiles=len(source['sha256']), packages=packages, counts=counts, errors=errors,
              scope='Artifact integrity and cross-reference checks; not UI implementation acceptance')
print(json.dumps(result, indent=2))
raise SystemExit(bool(errors))
