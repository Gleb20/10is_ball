#!/usr/bin/env python3
"""Validate every feedback atom and the evidence for any new acceptance claim."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

BASE_SHA = '42f7cca6ad7c96742807daef59d48504bf03fc000960bc4b32f1b864af65cf21'
ALLOWED = {'verified_local_prior_release', 'verified_local', 'pending_current_full_CI',
           'pending_current_guest_UI', 'pending_current_browser_evidence', 'evidence_only',
           'residual_reproduction', 'residual_physical_device', 'superseded_by_D40',
           'historical_target_replaced_by_current_task', 'deferred_by_D37'}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def checked_path(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError(f'Invalid evidence/source path: {relative}')
    return path

def check_evidence(root, ref):
    path = checked_path(root, ref['evidenceRef'])
    if digest(path) != ref['evidenceSha256']:
        raise ValueError(f'Evidence hash mismatch: {ref["evidenceRef"]}')
    return path

def validate(root, overlay_path):
    directory = root / 'docs/audits/2026-09-13-ux-ui/implementation'
    base_path = directory / 'coverage.csv'
    base = list(csv.DictReader(base_path.open(newline='')))
    overlay = json.loads(overlay_path.read_text())
    assert overlay['schemaVersion'] == 1
    assert digest(base_path) == BASE_SHA == overlay['baseCoverageSha256']
    key = lambda row: (row['source'], row['source_id'], row['atom_id'])
    base_by_key = {key(row): row for row in base}
    rows = overlay['results']
    assert len(base) == len(rows) == len(base_by_key) == 236
    assert len({tuple(row['key']) for row in rows}) == 236
    assert {tuple(row['key']) for row in rows} == set(base_by_key)
    prior = {key(row): row for row in json.loads((directory / 'implementation-results.json').read_text())['results']}
    current_needed = False
    for row in rows:
        identity = tuple(row['key'])
        original = base_by_key[identity]
        assert row['original_result'] == original['result'], identity
        assert row['canonical_task'] == original['canonical_task'], identity
        assert row['stage'] == int(original['stage']), identity
        state = row['current_result']
        assert state in ALLOWED, (identity, state)
        assert row.get('limitation'), identity
        for path in row.get('source_or_test_paths', []):
            checked_path(root, path)
        if state == 'verified_local_prior_release':
            assert identity in prior, identity
            check_evidence(root, row['acceptance'])
        elif state == 'verified_local':
            assert row.get('source_or_test_paths'), identity
            current_needed = True
        else:
            assert row.get('acceptance') is None, identity
        if state == 'superseded_by_D40':
            assert identity[1:] in {('U01-DETAIL-004', 'main'), ('U01-DETAIL-004', 'a01'), ('U01-DETAIL-004', 'a02')}, identity
    acceptance = overlay.get('currentAcceptance')
    if current_needed:
        assert acceptance, 'Current verification requires an acceptance receipt'
        receipt = json.loads(check_evidence(root, acceptance).read_text())
        assert receipt['status'] == 'passed' and receipt['scope'] == 'repository-wide'
        assert receipt['version'] and isinstance(receipt['limitations'], list)
        summary = json.loads(check_evidence(root, receipt['summary']).read_text())
        assert summary['status'] == 'passed'
        counts = summary['totals']
        assert counts['total'] > 0 and counts['passed'] == counts['total']
        assert all(counts[name] == 0 for name in ('failed', 'skipped', 'todo', 'interrupted'))
        assert {lane['name'] for lane in summary['lanes']} == {'quality', 'postgres', 'browser-prodlike', 'cleanup-foundation'}
        assert all(lane['status'] == 'passed' for lane in summary['lanes'])
    print(f'PASS: {len(rows)} completion atoms; new acceptance {"verified" if current_needed else "pending"}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--overlay', type=Path)
    args = parser.parse_args()
    validate(args.root, args.overlay or args.root / 'docs/audits/2026-09-13-ux-ui/implementation/completion-results.json')
