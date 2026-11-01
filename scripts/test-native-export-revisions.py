import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('native_export',ROOT/'scripts/export-session-telemetry.py')
export=importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


class NativeRevisionTests(unittest.TestCase):
    def test_only_declared_source_compatibility_is_allowed(self):
        self.assertTrue(export.compatible_revision('5b02cc1bb2a6daf808ad','a829fc069dfa8da25c00'))
        self.assertFalse(export.compatible_revision('unknown','a829fc069dfa8da25c00'))

    def test_mixed_native_entries_preserve_original_revision(self):
        self.assertEqual(export.entry_revisions({'sourceRevision':'old','entries':{'A':'a','B':'b'},
            'entrySourceRevisions':{'B':'new'}}),{'A':'old','B':'new'})


if __name__=='__main__': unittest.main()
