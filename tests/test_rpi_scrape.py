import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class ScrapeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.remote = self.root / 'remote.git'
        self.worker = self.root / 'worker'
        subprocess.run(['git', 'init', '--bare', '--initial-branch=main', str(self.remote)], check=True, capture_output=True)
        subprocess.run(['git', 'clone', str(self.remote), str(self.worker)], check=True, capture_output=True)
        self.git('config', 'user.name', 'Test')
        self.git('config', 'user.email', 'test@example.com')
        (self.worker / 'scripts').mkdir()
        for name in ('scrape.sh', 'start-scrape.sh'):
            shutil.copy(ROOT / 'scripts' / name, self.worker / 'scripts' / name)
        self.raw = self.worker / 'data/raw/2026-10-25.jsonl'
        self.raw.parent.mkdir(parents=True)
        self.raw.write_text('{"id":1,"jsonld":[]}\n')
        self.git('add', '.')
        self.git('commit', '-m', 'Initial')
        self.git('push', 'origin', 'main')
        self.initial = self.git('rev-parse', 'HEAD')
        tools = self.root / 'tools'
        tools.mkdir()
        npm = tools / 'npm'
        npm.write_text('''#!/usr/bin/env python3
import os, sys
from pathlib import Path
with open('npm-calls.log', 'a') as stream:
    stream.write(' '.join(sys.argv[1:]) + '\\n')
assert 'NODE_OPTIONS' not in os.environ
assert 'HTTPS_PROXY' not in os.environ
if sys.argv[1] == 'ci':
    sys.exit(int(os.environ.get('FAIL_INSTALL', '0')))
if sys.argv[1:] == ['run', 'scrape']:
    if os.environ.get('NEW_DATA'):
        with open('data/raw/2026-10-25.jsonl', 'a') as stream:
            stream.write('{"id":2,"jsonld":[]}\\n')
    sys.exit(int(os.environ.get('FAIL_SCRAPE', '0')))
raise SystemExit('Unexpected npm invocation')
''')
        npm.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(tools) + os.pathsep + os.environ['PATH'],
                    'NODE_OPTIONS': '--import=not-a-real-proxy', 'HTTPS_PROXY': 'http://unused'}

    def git(self, *args, cwd=None):
        return subprocess.check_output(['git', '-C', str(cwd or self.worker), *args], text=True, stderr=subprocess.DEVNULL).strip()

    def run_scrape(self, **env):
        return subprocess.run(['bash', str(self.worker / 'scripts/start-scrape.sh')],
                              env={**self.env, **env}, text=True, capture_output=True)

    def marker(self):
        return json.loads((self.worker / 'data/scrape-completed.json').read_text())

    def test_complete_publishes_once_and_retains_unrelated_changes(self):
        other = self.root / 'other'
        subprocess.run(['git', 'clone', str(self.remote), str(other)], check=True, capture_output=True)
        self.git('config', 'user.name', 'Other', cwd=other)
        self.git('config', 'user.email', 'other@example.com', cwd=other)
        (other / 'README').write_text('independent')
        self.git('add', 'README', cwd=other)
        self.git('commit', '-m', 'Independent', cwd=other)
        self.git('push', 'origin', 'main', cwd=other)
        result = self.run_scrape(NEW_DATA='1')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.marker()['status'], 'complete')
        self.assertNotIn('droplet_id', self.marker())
        self.assertEqual(len(self.raw.read_text().splitlines()), 2)
        self.assertEqual((self.worker / 'README').read_text(), 'independent')
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.git('rev-parse', 'origin/main'))
        self.assertEqual(self.git('log', '-1', '--format=%s'), 'Scrape complete')
        self.assertEqual(set(self.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').splitlines()),
                         {'data/raw/2026-10-25.jsonl', 'data/scrape-completed.json'})

    def test_partial_publishes_data_but_reports_failure(self):
        result = self.run_scrape(NEW_DATA='1', FAIL_SCRAPE='1')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(self.marker()['status'], 'partial')
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.git('rev-parse', 'origin/main'))
        self.assertEqual(len(self.raw.read_text().splitlines()), 2)

    def test_failure_without_data_does_not_publish(self):
        result = self.run_scrape(FAIL_SCRAPE='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.worker / 'data/scrape-completed.json').exists())
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.initial)

    def test_success_without_new_data_publishes_marker(self):
        result = self.run_scrape()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.marker()['status'], 'complete')
        self.assertEqual(len(self.raw.read_text().splitlines()), 1)

    def test_dependency_failure_never_starts_scraper(self):
        result = self.run_scrape(FAIL_INSTALL='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('run scrape', (self.worker / 'npm-calls.log').read_text())
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.initial)

    def test_update_failure_never_installs_or_scrapes(self):
        self.git('remote', 'set-url', 'origin', str(self.root / 'missing.git'))
        result = self.run_scrape()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.worker / 'npm-calls.log').exists())

    def test_push_failure_preserves_local_commit(self):
        hook = self.remote / 'hooks/pre-receive'
        hook.write_text('#!/bin/sh\nexit 1\n')
        hook.chmod(0o755)
        result = self.run_scrape(NEW_DATA='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.marker()['status'], 'complete')
        self.assertNotEqual(self.git('rev-parse', 'HEAD'), self.git('rev-parse', 'origin/main'))
        self.assertEqual(self.git('rev-parse', 'main', cwd=self.remote), self.initial)

    def test_updated_runner_is_executed(self):
        other = self.root / 'other'
        subprocess.run(['git', 'clone', str(self.remote), str(other)], check=True, capture_output=True)
        self.git('config', 'user.name', 'Other', cwd=other)
        self.git('config', 'user.email', 'other@example.com', cwd=other)
        (other / 'scripts/scrape.sh').write_text('#!/bin/bash\necho latest-runner\n')
        self.git('commit', '-am', 'Update runner', cwd=other)
        self.git('push', 'origin', 'main', cwd=other)
        result = self.run_scrape()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('latest-runner', result.stdout)
        self.assertFalse((self.worker / 'npm-calls.log').exists())


if __name__ == '__main__':
    unittest.main()
