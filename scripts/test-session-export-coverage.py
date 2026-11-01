"""Incomplete source histories retain observed laps, never fabricated laps."""
import importlib.util
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('export_session',ROOT/'scripts/export-local-session.py')
export=importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


class CoverageTests(unittest.TestCase):
    def test_gaps_are_metadata_not_a_reason_to_discard_other_laps(self):
        drivers=[{'code':'VER','lap_data_complete':True,'laps':[{'lap':2,'time':80.1}]},
                 {'code':'HUL','lap_data_complete':False,'missing_laps':[2,3,4,5,6,7,8],
                  'laps':[{'lap':1,'time':None},{'lap':9,'time':81.2}]}]
        self.assertEqual(export.lap_coverage(drivers),{'HUL':[2,3,4,5,6,7,8]})
        self.assertEqual([lap['lap'] for lap in drivers[1]['laps']],[1,9])

    def test_empty_session_is_still_rejected(self):
        with self.assertRaises(ValueError): export.lap_coverage([])


if __name__=='__main__': unittest.main()
