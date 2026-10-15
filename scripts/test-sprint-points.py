"""Classification-only sprint loading: no telemetry and no invented points."""
import io, json, sys, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import Response, HTTPException
import server

class SprintPointsTests(unittest.TestCase):
    def response(self, points='8', name='Chinese Grand Prix'):
        return io.BytesIO(json.dumps({'MRData':{'RaceTable':{'Races':[{
            'season':'2025','round':'2','raceName':name,'SprintResults':[
                {'number':'44','Driver':{'code':'HAM'},'Constructor':{'name':'Ferrari'},'points':points}]
        }]}}}).encode())

    @patch.object(server,'write_prepared_cache')
    @patch.object(server,'read_prepared_cache',return_value=None)
    def test_classification_needs_no_session_laps(self, read, write):
        with patch.object(server,'urlopen',return_value=self.response()), patch.object(server,'load_session',side_effect=AssertionError('No lap parsing')):
            result=server.sprint_classification(Response(),2025,'Chinese Grand Prix',2,False)
        self.assertEqual(result['drivers'][0]['result']['points'],8)
        self.assertTrue(result['classification_complete']);write.assert_called_once()

    @patch.object(server,'write_prepared_cache')
    @patch.object(server,'read_prepared_cache',return_value=None)
    @patch.object(server,'openf1_session',return_value=None)
    def test_wrong_event_or_missing_points_is_not_zero(self, fallback, read, write):
        for response in [self.response(name='Japanese Grand Prix'),self.response(points=None)]:
            with patch.object(server,'urlopen',return_value=response), self.assertRaises(HTTPException):
                server.sprint_classification(Response(),2025,'Chinese Grand Prix',2,False)
        write.assert_not_called()

if __name__=='__main__':unittest.main()
