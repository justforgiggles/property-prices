"""Exercise release ordering and real Git recovery without cloud or form writes."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.state = self.root / '.release/state.json'
        self.patch = patch.multiple(release, ROOT=self.root, STATE=self.state)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_stale_or_non_main_release_stops(self):
        with patch.dict(os.environ, GITHUB_SHA='source', GITHUB_REF='refs/heads/main'), patch.object(release, 'remote_head', return_value='newer'):
            with self.assertRaisesRegex(RuntimeError, 'current main'):
                release.current()
        with patch.dict(os.environ, GITHUB_SHA='source', GITHUB_REF='refs/heads/feature'), patch.object(release, 'remote_head', return_value='source'):
            with self.assertRaises(RuntimeError):
                release.current()

    def test_failed_candidate_never_promotes_or_publishes_and_recovers(self):
        release.save(dict(source='source', phase='prepared', manifest_sha256='hash'))
        old = dict(status=dict(traffic=[dict(revisionName='old', percent=100)], url='https://service'))
        candidate = dict(status=dict(latestReadyRevisionName='property-prices-valuation-r1-1', traffic=[
            dict(revisionName='property-prices-valuation-r1-1', tag='release-candidate', url='https://candidate')]))
        with (patch.object(release, 'current'), patch.object(release, 'describe', side_effect=[old, candidate, old]),
              patch.object(release, 'run'), patch.object(release, 'cloud') as cloud,
              patch.object(release, 'check_health', side_effect=RuntimeError('bad model')),
              patch.object(release, 'publish') as publish,
              patch.dict(os.environ, GITHUB_RUN_ID='1', GITHUB_RUN_ATTEMPT='1')):
            with self.assertRaisesRegex(RuntimeError, 'bad model'):
                release.deploy()
            publish.assert_not_called()
            cloud.assert_not_called()
            release.recover()
            self.assertEqual(cloud.call_args.args[-1], 'old=100')
        self.assertEqual(json.loads(self.state.read_text())['phase'], 'recovered')

    def test_success_checks_candidate_before_traffic_and_forms(self):
        release.save(dict(source='source', phase='prepared', manifest_sha256='hash'))
        events = []
        revision = 'property-prices-valuation-r1-1'
        before = dict(status=dict(traffic=[dict(revisionName='old', percent=100)], url='https://service'))
        candidate = dict(status=dict(latestReadyRevisionName=revision, traffic=[
            dict(revisionName=revision, tag='release-candidate', url='https://candidate')]))
        serving = dict(status=dict(traffic=[dict(revisionName=revision, percent=100)]))
        with (patch.object(release, 'current', side_effect=lambda: events.append('fresh')),
              patch.object(release, 'describe', side_effect=[before, candidate, serving]),
              patch.object(release, 'run', side_effect=lambda *a, **k: events.append('deploy')),
              patch.object(release, 'cloud', side_effect=lambda *a: events.append('promote')),
              patch.object(release, 'check_health', side_effect=lambda url, *a: events.append(url)),
              patch.object(release, 'publish', side_effect=lambda s: events.append('publish')),
              patch.dict(os.environ, GITHUB_RUN_ID='1', GITHUB_RUN_ATTEMPT='1')):
            release.deploy()
        self.assertEqual(events, ['fresh', 'deploy', 'https://candidate', 'fresh', 'promote', 'https://service', 'publish'])
        self.assertEqual(json.loads(self.state.read_text())['phase'], 'complete')

    def test_publication_push_failure_never_runs_hosted_verification(self):
        state = dict(source='source', paths=[])
        with (patch.object(release, 'current'), patch.object(release, 'stage_outputs', return_value='publication'),
              patch.object(release, 'git', side_effect=RuntimeError('push rejected')),
              patch.object(release, 'run') as run):
            with self.assertRaisesRegex(RuntimeError, 'push rejected'):
                release.publish(state)
            run.assert_not_called()
        self.assertEqual(json.loads(self.state.read_text())['publication'], 'publication')

    def test_publication_failure_restores_forms_and_traffic(self):
        release.save(dict(phase='publishing', deployment_attempted=True, previous_traffic={'old': 100}))
        with (patch.object(release, 'restore_outputs') as restore, patch.object(release, 'cloud') as cloud,
              patch.object(release, 'describe', return_value={'status': {'traffic': [{'revisionName': 'old', 'percent': 100}]}})):
            release.recover()
            restore.assert_called_once()
            cloud.assert_called_once()
            release.recover()
            cloud.assert_called_once()

    def test_form_conflict_still_restores_service_and_reports_incomplete(self):
        release.save(dict(phase='publishing', deployment_attempted=True, previous_traffic={'old': 100}))
        with (patch.object(release, 'restore_outputs', side_effect=RuntimeError('user edit')),
              patch.object(release, 'cloud') as cloud,
              patch.object(release, 'describe', return_value={'status': {'traffic': [{'revisionName': 'old', 'percent': 100}]}})):
            with self.assertRaisesRegex(RuntimeError, 'user edit'):
                release.recover()
            cloud.assert_called_once()
        self.assertEqual(json.loads(self.state.read_text())['phase'], 'recovery-incomplete')

    def make_repository(self):
        remote = self.root / 'remote.git'
        subprocess.run(['git', 'init', '--bare', str(remote)], check=True, capture_output=True)
        release.git('init', '-b', 'main')
        release.git('config', 'user.name', 'Test')
        release.git('config', 'user.email', 'test@example.com')
        release.git('remote', 'add', 'origin', str(remote))
        (self.root / 'generated.txt').write_text('old')
        release.git('add', 'generated.txt')
        release.git('commit', '-m', 'initial')
        source = release.git('rev-parse', 'HEAD')
        (self.root / 'generated.txt').write_text('new')
        release.git('commit', '-am', 'publish')
        publication = release.git('rev-parse', 'HEAD')
        release.git('push', 'origin', 'HEAD:main')
        return dict(source=source, publication=publication, paths=['generated.txt'])

    def test_git_recovery_preserves_intervening_unrelated_commit(self):
        state = self.make_repository()
        (self.root / 'unrelated.txt').write_text('keep me')
        release.git('add', 'unrelated.txt')
        release.git('commit', '-m', 'user change')
        release.git('push', 'origin', 'HEAD:main')
        original_run = release.run
        def run(*args, **kwargs):
            return None if args[0] == 'node' else original_run(*args, **kwargs)
        with patch.object(release, 'run', side_effect=run):
            release.restore_outputs(state)
        self.assertEqual((self.root / 'generated.txt').read_text(), 'old')
        self.assertEqual((self.root / 'unrelated.txt').read_text(), 'keep me')
        self.assertEqual(release.remote_head(), release.git('rev-parse', 'HEAD'))

    def test_git_recovery_refuses_intervening_generated_edit(self):
        state = self.make_repository()
        (self.root / 'generated.txt').write_text('user change')
        release.git('commit', '-am', 'user change')
        release.git('push', 'origin', 'HEAD:main')
        with self.assertRaisesRegex(RuntimeError, 'manual recovery'):
            release.restore_outputs(state)
        self.assertEqual((self.root / 'generated.txt').read_text(), 'user change')

    def test_preparation_failure_has_no_cloud_effects(self):
        with patch.object(release, 'cloud') as cloud:
            release.recover()
            release.save(dict(phase='prepared'))
            release.recover()
            cloud.assert_not_called()


if __name__ == '__main__':
    unittest.main()
