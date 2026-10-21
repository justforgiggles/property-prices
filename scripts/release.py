"""Coordinate one production release; external effects are journaled for recovery."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.release/state.json'
SERVICE = 'property-prices-valuation'
PROJECT = 'hirebarend'
REGION = 'europe-west3'


def run(*args, capture=False, **kwargs):
    result = subprocess.run(args, cwd=ROOT, check=True, text=True,
                            stdout=subprocess.PIPE if capture else None, **kwargs)
    return result.stdout.strip() if capture else None


def git(*args):
    return run('git', *args, capture=True)


def cloud(*args):
    return run('gcloud', 'run', *args, '--project', PROJECT, '--region', REGION,
               '--quiet', capture=True)


def describe():
    return json.loads(cloud('services', 'describe', SERVICE, '--format=json'))


def remote_head():
    return git('ls-remote', 'origin', 'refs/heads/main').split()[0]


def current():
    source = os.environ['GITHUB_SHA']
    if os.environ.get('GITHUB_REF') != 'refs/heads/main' or remote_head() != source:
        raise RuntimeError('Release is not the current main revision; run the workflow on current main.')
    return source


def save(state):
    STATE.parent.mkdir(exist_ok=True)
    temporary = STATE.with_suffix('.tmp')
    temporary.write_text(json.dumps(state, indent=2) + '\n')
    temporary.replace(STATE)


def generated_paths():
    paths = ['packages/model/locations.json', 'forms/property-valuation.yaml', 'forms/property-valuation copy.yaml']
    for profile in sorted((ROOT / 'forms/agents').glob('*.json')):
        paths.append(f'forms/property-valuation-{profile.stem}.yaml')
        paths.extend(f'forms/assets/{profile.stem}-{suffix}' for suffix in ('logo.png', 'icon.png', 'og.png', 'og.svg'))
    return paths


def prepare():
    source = current()
    from property_model.train.data import read_listings
    _, audit, _ = read_listings(ROOT / 'data/raw')
    manifest = ROOT / 'packages/model/models/manifest.json'
    metadata = json.loads(manifest.read_text())
    if metadata['provenance']['data_audit']['raw_sha256'] != audit['raw_sha256']:
        raise RuntimeError('Model does not match the committed raw data.')
    paths = generated_paths()
    changed = set(git('diff', '--name-only', 'HEAD').splitlines())
    untracked = set(git('ls-files', '--others', '--exclude-standard').splitlines())
    if (changed | untracked) - set(paths):
        raise RuntimeError(f'Unexpected release outputs: {sorted((changed | untracked) - set(paths))}')
    run('node', 'scripts/verify-hosted-forms.mjs', '--registered-only')
    save(dict(source=source, paths=paths, raw_sha256=audit['raw_sha256'],
              manifest_sha256=hashlib.sha256(manifest.read_bytes()).hexdigest(), phase='prepared'))


def check_health(url, revision, manifest_hash):
    last_error = None
    for attempt in range(12):
        try:
            with urlopen(url + '/health', timeout=60) as response:
                body = json.load(response)
            if (body.get('status'), body.get('revision'), body.get('manifest_sha256')) != ('ok', revision, manifest_hash):
                raise RuntimeError('Health response does not match the deployed revision and model.')
            return
        except Exception as error:
            last_error = error
            time.sleep(10)
    raise RuntimeError('Model health check failed') from last_error


def stage_outputs(state, message):
    git('config', 'user.name', 'github-actions[bot]')
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
    stageable = [path for path in state['paths'] if (ROOT / path).exists() or git('ls-files', '--', path)]
    if stageable:
        git('add', '--all', '--', *stageable)
    staged = git('diff', '--cached', '--name-only').splitlines()
    if set(staged) - set(state['paths']):
        raise RuntimeError('Refusing to commit files outside the generated output allowlist.')
    if staged:
        git('commit', '-m', message)
    return git('rev-parse', 'HEAD')


def publish(state):
    current()
    commit = stage_outputs(state, f"Publish generated forms for {state['source'][:12]} [skip ci]")
    state['publication'] = commit
    state['phase'] = 'publishing'
    save(state)
    if commit != state['source']:
        git('push', 'origin', 'HEAD:refs/heads/main')
    run('node', 'scripts/verify-hosted-forms.mjs')


def deploy():
    state = json.loads(STATE.read_text())
    current()
    before = describe()
    traffic = {entry['revisionName']: entry['percent'] for entry in before['status']['traffic'] if entry.get('percent', 0)}
    if sum(traffic.values()) != 100:
        raise RuntimeError('Cannot determine previous production traffic for rollback.')
    suffix = f"r{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}"
    revision = f'{SERVICE}-{suffix}'
    state.update(previous_traffic=traffic, url=before['status']['url'], revision=revision,
                 phase='deploying', deployment_attempted=True)
    save(state)
    run('sh', 'scripts/deploy.sh', env={**os.environ, 'RELEASE_REVISION_SUFFIX': suffix})
    candidate = describe()
    if candidate['status']['latestReadyRevisionName'] != revision:
        raise RuntimeError('Candidate revision is not ready.')
    candidate_url = next(entry['url'] for entry in candidate['status']['traffic']
                         if entry.get('tag') == 'release-candidate' and entry.get('revisionName') == revision)
    check_health(candidate_url, revision, state['manifest_sha256'])
    current()
    state['phase'] = 'promoting'
    save(state)
    cloud('services', 'update-traffic', SERVICE, '--to-revisions', f'{revision}=100')
    serving = describe()
    if not any(entry.get('revisionName') == revision and entry.get('percent') == 100 for entry in serving['status']['traffic']):
        raise RuntimeError('New revision does not receive 100% of traffic.')
    check_health(state['url'], revision, state['manifest_sha256'])
    publish(state)
    state['phase'] = 'complete'
    save(state)


def restore_outputs(state):
    publication = state.get('publication')
    if not publication or publication == state['source']:
        return
    git('fetch', 'origin', 'main')
    remote = git('rev-parse', 'origin/main')
    result = subprocess.run(['git', 'merge-base', '--is-ancestor', publication, remote], cwd=ROOT)
    if result.returncode == 1:
        return
    result.check_returncode()
    if git('diff', '--name-only', publication, remote, '--', *state['paths']):
        raise RuntimeError('Generated outputs changed after publication; manual recovery required to preserve those edits.')
    git('checkout', '-B', 'release-recovery', remote)
    existing = git('ls-tree', '-r', '--name-only', state['source'], '--', *state['paths']).splitlines()
    added = sorted(set(state['paths']) - set(existing))
    if existing:
        git('restore', '--source', state['source'], '--staged', '--worktree', '--', *existing)
    if added:
        git('rm', '--ignore-unmatch', '--', *added)
    stage_outputs(state, f"Restore generated forms after failed release {state['source'][:12]} [skip ci]")
    git('push', 'origin', 'HEAD:refs/heads/main')
    run('node', 'scripts/verify-hosted-forms.mjs')


def recover():
    if not STATE.exists():
        return
    state = json.loads(STATE.read_text())
    if state['phase'] in ('complete', 'recovered') or not state.get('deployment_attempted'):
        return
    errors = []
    try:
        restore_outputs(state)
    except Exception as error:
        errors.append(f'Form recovery: {error}')
    try:
        traffic = ','.join(f'{revision}={percent}' for revision, percent in state['previous_traffic'].items())
        cloud('services', 'update-traffic', SERVICE, '--to-revisions', traffic)
        restored = {entry['revisionName']: entry['percent'] for entry in describe()['status']['traffic'] if entry.get('percent', 0)}
        if restored != state['previous_traffic']:
            raise RuntimeError('Previous traffic was not restored.')
    except Exception as error:
        errors.append(f'Service recovery: {error}')
    state.update(phase='recovery-incomplete' if errors else 'recovered', recovery_errors=errors)
    save(state)
    if errors:
        raise RuntimeError('; '.join(errors))


def summary():
    print('## Property-prices release')
    if STATE.exists():
        state = json.loads(STATE.read_text())
        for key in ('phase', 'source', 'raw_sha256', 'manifest_sha256', 'revision', 'publication', 'previous_traffic', 'url', 'recovery_errors'):
            if key in state:
                print(f'- **{key}**: `{state[key]}`')
    else:
        print('Release stopped before deployment preparation. See the failed step logs.')


if __name__ == '__main__':
    os.chdir(ROOT)
    commands = dict(current=current, prepare=prepare, deploy=deploy, recover=recover, summary=summary)
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        sys.exit('Usage: release.py current|prepare|deploy|recover|summary')
    commands[sys.argv[1]]()
