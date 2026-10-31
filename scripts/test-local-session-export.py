"""Completed local snapshots preserve existing exports and reject live sessions."""
from datetime import datetime, timedelta, timezone
import gzip
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('local_export',ROOT/'scripts/export-local-session.py')
export=importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)
mirror_spec=importlib.util.spec_from_file_location('mirror',ROOT/'scripts/mirror-openf1.py')
mirror=importlib.util.module_from_spec(mirror_spec)
mirror_spec.loader.exec_module(mirror)


class LocalSessionExportTests(unittest.TestCase):
    def test_older_python_capture_cannot_replace_newer_observation(self):
        with TemporaryDirectory() as directory:
            root=Path(directory);(root/'lib').mkdir()
            (root/'lib/cache-revision.mjs').write_text('export const SOURCE_REVISION = "s"; export const BACKEND_REVISION = "b"; export const RACE_REVISION = "r";')
            def capture(at):
                return {'drivers':[{'code':'VER'}],'local_export':{'captured_at':at}}
            newer=capture('2026-10-31T12:00:00Z')
            key=export.merge_local_session_capture(root,2026,'Mexico',19,'Practice 2',newer)
            target=root/'assets/data/local-captures/index.json'
            original=target.read_bytes()
            export.merge_local_session_capture(root,2026,'Mexico',19,'Practice 2',capture('2026-10-31T11:00:00Z'))
            self.assertEqual(target.read_bytes(),original)
            entry=json.loads(original)['entries'][key]
            self.assertEqual(json.loads(gzip.decompress((target.parent/entry['file']).read_bytes())),newer)
            with self.assertRaises(ValueError):
                export.merge_local_session_capture(root,2026,'Mexico',19,'Practice 2',capture('invalid'))
            self.assertEqual(target.read_bytes(),original)

    def test_recent_stream_capture_and_explicit_refresh_use_real_source_rows(self):
        with TemporaryDirectory() as directory, patch.object(export.server,'PREPARED_CACHE',Path(directory)),patch.object(export.server,'RAW_ROOT',Path(directory)/'raw'):
            with patch.object(export.server,'openf1',return_value=[{'speed':200}]):
                self.assertGreater(mirror.capture_stream('car_data',11389,'1',include_recent=True),0)
            with patch.object(export.server,'openf1',side_effect=AssertionError('Must bypass settled cache')),patch.object(export.server,'_openf1_fetch',return_value=[{'speed':210}]):
                mirror.capture_stream('car_data',11389,'1',refresh=True)
            file=export.server.openf1_cache_path(export.server.openf1_url('car_data',session_key=11389,driver_number='1'))
            self.assertEqual(json.loads(gzip.decompress(file.read_bytes())),[{'speed':210}])

    def test_only_confirmed_finished_sessions_are_exportable(self):
        now=datetime(2026,10,23,20,tzinfo=timezone.utc)
        classification=[{'position':i} for i in range(1,4)]
        ended={'date_end':(now-timedelta(hours=1)).isoformat()}
        export.validate_finished(ended,classification,now)
        for bad in ({}, {'date_end':(now+timedelta(hours=1)).isoformat()}, {**ended,'is_cancelled':True}):
            with self.assertRaises(ValueError):export.validate_finished(bad,classification,now)
        with self.assertRaises(ValueError):export.validate_finished(ended,[],now)

    def test_merge_keeps_existing_entries_and_marks_recent_capture(self):
        with TemporaryDirectory() as directory:
            root=Path(directory)
            folder=root/'assets/data/prerendered';folder.mkdir(parents=True)
            (root/'lib').mkdir()
            (root/'lib/cache-revision.mjs').write_text('export const SOURCE_REVISION = "source-1";')
            manifest={'revision':'backend-1','sourceRevision':'source-1','entries':{'old-query':'old.json.gz'}}
            (folder/'index.json').write_text(json.dumps(manifest))
            (folder/'old.json.gz').write_bytes(b'unchanged')
            payload={'drivers':[{'code':'VER'}],'local_export':{'provisional':True,'session_key':11389}}
            query=export.merge_session_export(root,2026,'United States Grand Prix',18,'Practice 1',payload)
            actual=json.loads((folder/'index.json').read_text())
            self.assertEqual(actual['entries']['old-query'],'old.json.gz')
            self.assertEqual((folder/'old.json.gz').read_bytes(),b'unchanged')
            self.assertEqual(actual['revision'],'backend-1')
            self.assertEqual(actual['captures'][query],payload['local_export'])
            self.assertIn('round=18&session=Practice+1&year=2026',query)
            self.assertEqual(json.loads(gzip.decompress((folder/actual['entries'][query]).read_bytes())),payload)
            (root/'lib/cache-revision.mjs').write_text('export const SOURCE_REVISION = "source-2";')
            with self.assertRaises(ValueError):export.merge_session_export(root,2026,'United States Grand Prix',18,'Practice 2',payload)


if __name__=='__main__':unittest.main()
