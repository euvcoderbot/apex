import importlib.util
import json
import subprocess
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('scheduler', ROOT / 'scripts' / 'session-archive-scheduler.py')
scheduler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scheduler)
NOW = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)


def session(key, end, name='Practice 1', cancelled=False):
    return {'session_key': key, 'date_end': end.isoformat(), 'session_name': name, 'year': 2026, 'is_cancelled': cancelled}


class SchedulerTests(unittest.TestCase):
    def test_sync_uses_same_project_site_checkout_and_apply(self):
        with TemporaryDirectory() as directory:
            root=Path(directory)/'local'; target=Path(directory)/'site'
            for folder in (root,target):
                (folder/'.openai').mkdir(parents=True)
                (folder/'.openai'/'hosting.json').write_text(json.dumps({'project_id':'test-site'}))
            (target/'scripts').mkdir()
            (target/'scripts'/'sync-prepared-sessions.mjs').write_text('// test')
            with patch.object(scheduler,'ROOT',root), patch.dict('os.environ',{'APEX_SITE_CHECKOUT':str(target)}), \
                 patch.object(scheduler.shutil,'which',return_value='node'), patch.object(scheduler.subprocess,'run') as run:
                scheduler.sync_prepared()
                args=run.call_args.args[0]
                self.assertEqual(args[-5:],['--from',str(root),'--to',str(target),'--apply'])
                (target/'.openai'/'hosting.json').write_text(json.dumps({'project_id':'different'}))
                with self.assertRaises(RuntimeError): scheduler.sync_prepared()
                self.assertEqual(run.call_count,1)

    def test_partial_calculation_still_stages_export_but_failure_propagates(self):
        item={'year':2026,'session_name':'Qualifying'}
        event={'name':'Test GP','round':1}
        response=MagicMock()
        response.__enter__.return_value=response
        with patch.object(scheduler.server,'event_calendar',return_value=[event]), \
             patch.object(scheduler,'event_for_session',return_value=(event,'Qualifying')), \
             patch.object(scheduler.shutil,'which',return_value='node'), \
             patch.object(scheduler,'urlopen',return_value=response), \
             patch.object(scheduler.json,'load',return_value={'mode':'local'}), \
             patch.object(scheduler,'revisions',return_value={}), \
             patch.object(scheduler.subprocess,'run',side_effect=[None,None,subprocess.CalledProcessError(2,'precompute')]), \
             patch.object(scheduler,'sync_prepared') as sync:
            with self.assertRaises(subprocess.CalledProcessError): scheduler.prepare_session(item,False)
            sync.assert_called_once()

    def test_plan_waits_35_minutes_and_ignores_cancelled_and_far_events(self):
        sessions = [session(1, NOW + timedelta(hours=2)), session(2, NOW + timedelta(days=9)),
                    session(3, NOW + timedelta(hours=1), cancelled=True)]
        self.assertEqual(scheduler.planned_starts(sessions, NOW), [NOW + timedelta(hours=2, minutes=35)])

    def test_finish_requires_race_control_or_results(self):
        with patch.object(scheduler.server, 'openf1', return_value=[]):
            self.assertFalse(scheduler.finished(session(1, NOW)))
        with patch.object(scheduler.server, 'openf1', side_effect=lambda endpoint, **kw: [{'flag': 'CHEQUERED'}] if endpoint == 'race_control' else []):
            self.assertTrue(scheduler.finished(session(1, NOW)))

    def test_plan_keeps_current_retry_window(self):
        items = [session(1, NOW - timedelta(hours=1)), session(2, NOW - timedelta(hours=11))]
        self.assertEqual(scheduler.planned_starts(items, NOW), [NOW - timedelta(minutes=25)])

    def test_a_live_session_401_falls_back_to_the_saved_schedule(self):
        import urllib.error
        live = urllib.error.HTTPError('x', 401, 'Unauthorized', {}, None)
        with TemporaryDirectory() as directory, patch.object(scheduler.server, 'RAW_ROOT', Path(directory)):
            sessions = [session(1, NOW)]
            with patch.object(scheduler.server, 'openf1', return_value=sessions):
                self.assertEqual(scheduler.schedule(2026), sessions)
            with patch.object(scheduler.server, 'openf1', side_effect=live):
                self.assertEqual(scheduler.schedule(2026), sessions, 'the saved list is used while OpenF1 refuses')
                with self.assertRaises(urllib.error.HTTPError):
                    scheduler.schedule(2027)  # nothing saved for this year: the error is real

    def test_event_match_uses_exact_session_time(self):
        item = {**session(1, NOW), 'date_start': (NOW - timedelta(hours=1)).isoformat()}
        event = {'name': 'Test GP', 'round': 2, 'session_dates': {'Practice 1': item['date_start']}}
        self.assertEqual(scheduler.event_for_session(item, [event]), (event, 'Practice 1'))
        with self.assertRaises(ValueError):
            scheduler.event_for_session(item, [event, event])

    def test_no_download_before_finish_or_when_provisional_ready(self):
        items = [session(1, NOW - timedelta(hours=1))]
        with TemporaryDirectory() as directory, patch.object(scheduler.server, 'RAW_ROOT', Path(directory)), \
             patch.object(scheduler.mirror, 'acquire_watch_lock', return_value=None), \
             patch.object(scheduler.mirror, 'run_once') as run, patch.object(scheduler, 'finished', return_value=False):
            scheduler.run_due(items, NOW)
            run.assert_not_called()
            scheduler.mirror.save_state({'sessions': {}, 'provisional_sessions': {'1': {'ready': True}}})
            scheduler.run_due(items, NOW)
            run.assert_not_called()

    def test_failed_provisional_capture_retries_and_final_refresh_is_due(self):
        items = [session(1, NOW - timedelta(hours=1)), session(2, NOW - timedelta(hours=7))]
        with TemporaryDirectory() as directory, patch.object(scheduler.server, 'RAW_ROOT', Path(directory)), \
             patch.object(scheduler.mirror, 'acquire_watch_lock', return_value=None), \
             patch.object(scheduler.mirror, 'run_once') as run, patch.object(scheduler, 'prepare_session'), \
             patch.object(scheduler, 'finished', return_value=True):
            scheduler.mirror.save_state({'sessions': {}, 'provisional_sessions': {'1': {'ready': False}, '2': {'ready': True}}})
            scheduler.run_due(items, NOW)
            self.assertEqual(run.call_count, 2)

    def test_settled_archive_prepares_once_and_records_completion(self):
        item = session(1, NOW - timedelta(hours=7))
        with TemporaryDirectory() as directory, patch.object(scheduler.server, 'RAW_ROOT', Path(directory)), \
             patch.object(scheduler.mirror, 'acquire_watch_lock', return_value=None), \
             patch.object(scheduler, 'prepare_session') as prepare, patch.object(scheduler, 'finished', return_value=True):
            scheduler.mirror.save_state({'sessions': {'1': {}}, 'provisional_sessions': {}})
            scheduler.run_due([item], NOW)
            scheduler.run_due([item], NOW)
            prepare.assert_called_once_with(item, True)
            self.assertEqual(scheduler.load_compute_state()['sessions']['1']['phase'], 'final')

    def test_failed_preparation_is_not_recorded_and_is_retried(self):
        item = session(1, NOW - timedelta(hours=7))
        with TemporaryDirectory() as directory, patch.object(scheduler.server, 'RAW_ROOT', Path(directory)), \
             patch.object(scheduler.mirror, 'acquire_watch_lock', return_value=None), \
             patch.object(scheduler, 'prepare_session', side_effect=RuntimeError('not ready')) as prepare, \
             patch.object(scheduler, 'finished', return_value=True):
            scheduler.mirror.save_state({'sessions': {'1': {}}, 'provisional_sessions': {}})
            scheduler.run_due([item], NOW)
            scheduler.run_due([item], NOW)
            self.assertEqual(prepare.call_count, 2)
            self.assertNotIn('1', scheduler.load_compute_state()['sessions'])


if __name__ == '__main__':
    unittest.main()
