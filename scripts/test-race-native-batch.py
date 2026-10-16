import sys, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import Response
import server

class RaceNativeBatchTests(unittest.TestCase):
    @patch.object(server,'write_prepared_cache')
    @patch.object(server,'read_prepared_cache',return_value=None)
    @patch('verified_sources.recorded_session',return_value={'data':{'openf1_session_key':99}})
    def test_three_stream_requests_are_reused_for_all_laps(self, recording, read, write):
        rows=[{'lap_number':n,'date_start':f'2026-10-11T12:0{n}:00+00:00','lap_duration':60} for n in [1,2,3]]
        def source(endpoint,**kwargs):return rows if endpoint=='laps' else [{'date':'2026-10-11T12:00:00+00:00'}]
        seen=[]
        def samples(*args,**kwargs):
            seen.append(kwargs['streams']);return [{'Distance':i*50,'ElapsedSeconds':i*2,'Speed':150,'X':i,'Y':i} for i in range(31)]
        with patch.object(server,'openf1',side_effect=source) as upstream,patch.object(server._openf1_lap_telemetry,'__wrapped__',side_effect=samples):
            result=server.race_native_laps(Response(),2026,'Test Grand Prix','1',99,False)
        self.assertEqual(upstream.call_count,3);self.assertEqual(len(result['laps']),3)
        self.assertTrue(all(s is seen[0] for s in seen));self.assertEqual(result['method'],'native-race-streams-v1')
        self.assertEqual(result['columns'][:3],['Distance','ElapsedSeconds','Speed']);write.assert_called_once()

if __name__=='__main__':unittest.main()
