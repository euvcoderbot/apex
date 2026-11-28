"""Live timing engine (live_timing.py): feed decoding, merging, the timing snapshot, completed laps and replay. No network."""
from pathlib import Path
import base64
import json
import math
import sys
import unittest
import zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import live_timing as lt

T0 = 1_780_000_000.0   # an arbitrary UTC second


def z(payload):
    raw = zlib.compressobj(9, zlib.DEFLATED, -zlib.MAX_WBITS)
    return base64.b64encode(raw.compress(json.dumps(payload).encode()) + raw.flush()).decode()


def iso(seconds):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(seconds, timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f') + '0Z'   # F1 sends 7 digits


def speed_at(t, period=60.0):
    """A repeating 'lap': slow corner at the start of each period, fast straight halfway."""
    return 150 + 150 * math.sin(math.pi * ((t % period) / period))


class Decoding(unittest.TestCase):
    def test_compressed_payload_round_trips(self):
        self.assertEqual(lt.decode_z(z({'a': [1, 2]})), {'a': [1, 2]})

    def test_merge_updates_nested_dicts_and_indexed_lists(self):
        target = {'Lines': {'1': {'Sectors': [{'Value': '30.1'}, {'Value': ''}], 'Position': '2'}}}
        lt.merge(target, {'Lines': {'1': {'Sectors': {'1': {'Value': '31.2'}}, 'Position': '1'}}})
        self.assertEqual(target['Lines']['1']['Sectors'][1]['Value'], '31.2')
        self.assertEqual(target['Lines']['1']['Position'], '1')

    def test_lap_times_parse(self):
        self.assertEqual(lt.lap_seconds('1:25.418'), 85.418)
        self.assertEqual(lt.lap_seconds('58.301'), 58.301)
        self.assertIsNone(lt.lap_seconds(''))
        self.assertIsNone(lt.lap_seconds(None))

    def test_seven_digit_utc_and_numbers(self):
        self.assertAlmostEqual(lt._utc_seconds(iso(T0 + .25)), T0 + .25, places=3)
        self.assertEqual(lt._utc_seconds(12.5), 12.5)


class Snapshot(unittest.TestCase):
    def test_timing_tower_from_driver_list_timing_and_stints(self):
        state = lt.LiveState()
        state.apply('DriverList', {'1': {'Tla': 'NOR', 'TeamName': 'McLaren', 'TeamColour': 'F47600', 'Line': 1},
                                   '81': {'Tla': 'PIA', 'TeamName': 'McLaren', 'TeamColour': 'F47600', 'Line': 2}})
        state.apply('TimingData', {'Lines': {'1': {'Position': '1', 'NumberOfLaps': 3, 'LastLapTime': {'Value': '1:20.000', 'OverallFastest': True}},
                                             '81': {'Position': '2', 'GapToLeader': '+1.2', 'IntervalToPositionAhead': {'Value': '+1.2'}}}})
        state.apply('TimingAppData', {'Lines': {'1': {'Stints': [{'Compound': 'SOFT', 'New': 'true', 'TotalLaps': 3}]}}})
        state.apply('TrackStatus', {'Status': '4', 'Message': 'SCDeployed'})
        snap = state.snapshot()
        self.assertEqual([d['code'] for d in snap['drivers']], ['NOR', 'PIA'])
        self.assertTrue(snap['drivers'][0]['last']['overall'])
        self.assertEqual(snap['drivers'][0]['stint'], {'compound': 'SOFT', 'new': True, 'laps': 3})
        self.assertEqual(snap['drivers'][1]['interval'], '+1.2')
        self.assertEqual(snap['track_status']['label'], 'Safety car')
        self.assertEqual(snap['drivers'][0]['color'], '#F47600')

    def test_pedal_values_read_as_fastf1_does(self):
        state = lt.LiveState()
        state.apply('CarData.z', z({'Entries': [{'Utc': iso(T0), 'Cars': {'1': {'Channels': {'0': 9000, '2': 120, '3': 3, '4': 104, '5': 104}}}},
                                                {'Utc': iso(T0 + .3), 'Cars': {'1': {'Channels': {'0': 9000, '2': 130, '3': 3, '4': 40, '5': 1}}}}]}))
        samples = state.telemetry_for(['1'], 300)['1']
        self.assertIsNone(samples[0]['throttle']); self.assertIsNone(samples[0]['brake'])
        self.assertEqual((samples[1]['throttle'], samples[1]['brake']), (40, 100))

    def test_samples_take_the_message_clock(self):
        state = lt.LiveState()
        late = T0 + 7   # the cars' own clock is 7 s behind the message
        state.apply('CarData.z', z({'Entries': [{'Utc': iso(T0), 'Cars': {'1': {'Channels': {'2': 100}}}},
                                                {'Utc': iso(T0 + .5), 'Cars': {'1': {'Channels': {'2': 101}}}}]}), late + .5)
        times = [s['t'] for s in state.telemetry['1']]
        self.assertAlmostEqual(times[-1], late + .5, places=3)
        self.assertAlmostEqual(times[-1] - times[0], .5, places=3)


def drive(state, laps=4, period=60.0, lap_times=True):
    """One car lapping every `period` seconds: car data each second (four samples), lap count at each line crossing."""
    state.apply('DriverList', {'1': {'Tla': 'NOR', 'TeamColour': 'F47600'}})
    for second in range(int(period * laps) + 3):
        t = T0 + second
        entries = [{'Utc': iso(t + k * .25), 'Cars': {'1': {'Channels': {'2': round(speed_at(second + k * .25, period)), '3': 5, '4': 80, '5': 0}}}} for k in range(4)]
        state.apply('CarData.z', z({'Entries': entries}), t + .75)
        if second and second % int(period) == 0:
            change = {'NumberOfLaps': second // int(period)}
            if lap_times:
                change['LastLapTime'] = {'Value': f'{int(period) // 60}:{period % 60:06.3f}'}
            state.apply('TimingData', {'Lines': {'1': change}}, t)


class LiveAuthentication(unittest.TestCase):
    def test_signing_in_reconnects_without_discarding_received_laps(self):
        import tempfile
        from unittest.mock import patch

        auth = {'available': False}
        attempts = []

        class Client:
            def __init__(self, filename, timeout, no_auth):
                self.no_auth = no_auth
                self._connection = None

            def _run(self):
                attempts.append(self.no_auth)
                if len(attempts) == 1:
                    manager.state.laps['1'][2] = {'lap': 2, 'seconds': 90.0}
                    auth['available'] = True
                    manager.refresh_live_auth()
                else:
                    manager.source.stop()

        with tempfile.TemporaryDirectory() as folder:
            manager = lt.LiveManager(Path(folder))
            with patch.object(lt, 'stored_token_status', side_effect=lambda: dict(auth)), \
                 patch('fastf1.livetiming.client.SignalRClient', Client):
                manager.source = lt.LiveSource(manager.state, Path(folder))
                manager.source.run()

        self.assertEqual(attempts, [True, False])
        self.assertTrue(manager.source.detail['authenticated'])
        self.assertEqual(manager.state.laps['1'][2]['seconds'], 90.0)


    def test_connecting_without_a_sign_in_leaves_out_the_empty_token_factory(self):
        """FastF1 3.9.2 passes access_token_factory=None when not signed in; signalrcore then refuses to connect."""
        import types
        from unittest.mock import patch

        class HubConnectionBuilder:   # signalrcore's check, as it raises
            def with_url(self, hub_url, options=None):
                if options and 'access_token_factory' in options and not callable(options['access_token_factory']):
                    raise TypeError('access_token_factory is not function')
                self.options = options
                return self

        client = types.ModuleType('fastf1.livetiming.client')
        client.HubConnectionBuilder = HubConnectionBuilder
        livetiming = types.ModuleType('fastf1.livetiming'); livetiming.client = client
        fastf1 = types.ModuleType('fastf1'); fastf1.livetiming = livetiming
        with patch.dict(sys.modules, {'fastf1': fastf1, 'fastf1.livetiming': livetiming, 'fastf1.livetiming.client': client}):
            with self.assertRaisesRegex(TypeError, 'not function'):
                client.HubConnectionBuilder().with_url('u', options={'access_token_factory': None})
            lt.allow_unauthenticated_connection()
            lt.allow_unauthenticated_connection()   # once only: no wrapper around the wrapper
            self.assertIs(client.HubConnectionBuilder.__mro__[1], HubConnectionBuilder)
            built = client.HubConnectionBuilder().with_url('u', options={'verify_ssl': True, 'access_token_factory': None})
            self.assertEqual(built.options, {'verify_ssl': True})
            token = lambda: 'abc'
            built = client.HubConnectionBuilder().with_url('u', options={'access_token_factory': token})
            self.assertIs(built.options['access_token_factory'], token)


class CompletedLaps(unittest.TestCase):
    def test_timed_lap_is_available_while_telemetry_is_missing(self):
        state = lt.LiveState()
        state.apply('TimingData', {'Lines': {'1': {'NumberOfLaps': 1}}}, T0)
        state.telemetry['1'].append({'t': T0 + 20, 'speed': 100})
        state.apply('TimingData', {'Lines': {'1': {'NumberOfLaps': 2, 'LastLapTime': {'Value': '1:00.000'}}}}, T0 + 60)

        self.assertEqual(state.lap_list()['1'][0]['time'], '1:00.000')
        self.assertIsNone(state.lap_trace('1', 2))
        state.telemetry['1'].append({'t': T0 + 62, 'speed': 100})
        state._flush_laps()
        self.assertEqual(state.lap_list()['1'][0]['time'], '1:00.000')
        self.assertIsNone(state.lap_trace('1', 2))

    def test_laps_are_cut_between_lap_count_changes(self):
        state = lt.LiveState()
        drive(state)
        laps = state.lap_list()['1']
        self.assertEqual([l['lap'] for l in laps], [2, 3, 4])   # lap 1 has no start mark before it
        lap = state.lap_trace('1', 3)
        self.assertAlmostEqual(lap['t'][-1], 60, delta=1.0)
        expected = sum(speed_at(s / 10) for s in range(600)) / 10 / 3.6   # metres in one period
        self.assertAlmostEqual(lap['distance'], expected, delta=expected * .03)
        self.assertEqual(lap['time'], '1:00.000')

    def test_fastest_and_last(self):
        state = lt.LiveState()
        drive(state)
        state.laps['1'][3]['seconds'] = 59.0
        self.assertEqual(state.lap_trace('1', 'fastest')['lap'], 3)
        self.assertEqual(state.lap_trace('1', 'last')['lap'], 4)
        self.assertTrue(next(l for l in state.lap_list()['1'] if l['lap'] == 3)['fastest'])
        self.assertIsNone(state.lap_trace('1', 99))
        self.assertIsNone(state.lap_trace('44', 'fastest'))

    def test_practice_laps_use_fastf1_numbers_and_keep_sectors(self):
        race, practice = lt.LiveState(), lt.LiveState()
        practice.apply('SessionInfo', {'Type': 'Practice', 'Path': '2026/x/p/'})
        race.apply('SessionInfo', {'Type': 'Race', 'Path': '2026/x/r/'})
        for state in (race, practice):
            state.apply('TimingData', {'Lines': {'1': {'Sectors': [{'Value': '18.315', 'OverallFastest': True}, {'Value': '36.460'}, {'Value': '15.988'}]}}})
            drive(state, laps=3)
        self.assertEqual(sorted(race.laps['1']), [2, 3])
        self.assertEqual(sorted(practice.laps['1']), [1, 2])   # F1's counter also counts the first pit exit outside races
        sectors = practice.lap_trace('1', 2)['sectors']
        self.assertEqual([s['time'] for s in sectors], ['18.315', '36.460', '15.988'])
        self.assertTrue(sectors[0]['overall'])
        self.assertFalse(practice.missing_laps())

    def test_latest_push_lap_skips_cool_down_and_pit_laps(self):
        state = lt.LiveState()
        drive(state, laps=5)
        for lap, seconds, pit in ((2, 60.0, False), (3, 75.0, False), (4, 61.0, False), (5, 59.0, True)):
            state.laps['1'][lap].update(seconds=seconds, pit=pit)
        self.assertEqual(state.lap_trace('1', 'latest')['lap'], 4)          # 3 is a cool-down lap, 5 a pit lap
        self.assertEqual([l['push'] for l in state.lap_list()['1']], [True, False, True, False])

    def test_recordings_restore_captured_laps(self):
        import tempfile
        recorded = lt.LiveState()
        lines = []
        original = recorded.apply

        def record(topic, data, stamp=None):
            lines.append(repr([topic, data, iso(stamp) if isinstance(stamp, float) else (stamp or '')]))
            original(topic, data, stamp)
        recorded.apply = record
        drive(recorded, laps=3)
        with tempfile.TemporaryDirectory() as folder:
            (Path(folder) / 'live-20261106-120000.txt').write_text('\n'.join(lines), encoding='utf-8')
            restored = lt.LiveState()
            self.assertEqual(lt.restore_recordings(restored, Path(folder)), len(lines))
        self.assertEqual(sorted(restored.laps['1']), sorted(recorded.laps['1']))

    def test_lap_time_arriving_after_the_lap_count(self):
        state = lt.LiveState()
        drive(state, laps=3, lap_times=False)
        state.apply('TimingData', {'Lines': {'1': {'LastLapTime': {'Value': '1:00.250'}}}}, T0 + 181)
        self.assertEqual(state.laps['1'][3]['time'], '1:00.250')

    def test_pit_laps_are_not_fastest(self):
        state = lt.LiveState()
        drive(state)
        for lap in state.laps['1'].values():
            lap['seconds'] = 70.0
        state.laps['1'][2].update({'seconds': 50.0, 'pit': True})
        self.assertEqual(state.lap_trace('1', 'fastest')['lap'] if state.lap_trace('1', 'fastest') else None, 3)

    def test_alignment_recovers_a_rotated_lap(self):
        points = 400
        reference = {'d': [i * 10.0 for i in range(points)], 'speed': [round(speed_at(i * .15)) for i in range(points)],
                     't': [i * .15 for i in range(points)], 'throttle': [0] * points, 'brake': [0] * points, 'gear': [5] * points}
        reference['distance'] = reference['d'][-1]
        rotated = dict(reference, speed=reference['speed'][40:] + reference['speed'][:40])   # starts 10% further round
        aligned = lt.align_lap(rotated, reference)
        self.assertAlmostEqual(abs(aligned['shift']), .1, delta=.01)
        self.assertEqual(aligned['speed'][:5], reference['speed'][:5])
        self.assertEqual(lt.align_lap(reference, reference)['shift'], 0)


class Replay(unittest.TestCase):
    def test_replay_feeds_the_same_state_from_archived_lines(self):
        car = z({'Entries': [{'Utc': iso(T0 + 1), 'Cars': {'1': {'Channels': {'2': 200}}}}]})
        streams = {
            'DriverList': ['00:00:00.000{"1": {"Tla": "NOR"}}'],
            'TimingData': ['00:00:01.000{"Lines": {"1": {"Position": "1"}}}'],
            'LapCount': ['00:00:01.500{"CurrentLap": 1, "TotalLaps": 50}'],
            'CarData.z': [f'00:00:01.200"{car}"'],
        }
        state = lt.LiveState()
        source = lt.ReplaySource(state, '/static/x/', speed=100, fetch=lambda path, topic: streams.get(topic))
        source.run()
        self.assertIsNone(source.error)
        snap = state.snapshot()
        self.assertEqual(snap['drivers'][0]['code'], 'NOR')
        self.assertEqual(snap['lap'], {'current': 1, 'total': 50})
        self.assertAlmostEqual(source.base, T0 + 1 - 1.2, places=3)
        self.assertEqual(len(state.telemetry['1']), 1)

    def test_replay_without_cached_data_explains_itself(self):
        source = lt.ReplaySource(lt.LiveState(), '/static/x/', fetch=lambda path, topic: None)
        source.run()
        self.assertIn('not in the local cache', source.error)

    def test_backfill_adds_laps_from_before_the_connection(self):
        def stamp(seconds):
            return f'{int(seconds // 3600):02d}:{int(seconds % 3600 // 60):02d}:{seconds % 60:06.3f}'
        car, timing = [], []
        for second in range(0, 185):
            entries = [{'Utc': iso(T0 + second + k * .25), 'Cars': {'1': {'Channels': {'2': round(speed_at(second + k * .25))}}}} for k in range(4)]
            car.append(f'{stamp(second + .75)}"{z({"Entries": entries})}"')
            if second and second % 60 == 0:
                timing.append(stamp(second) + json.dumps({'Lines': {'1': {'NumberOfLaps': second // 60, 'LastLapTime': {'Value': '1:00.000'}}}}))
        streams = {'TimingData': timing, 'CarData.z': car, 'DriverList': ['00:00:00.000{"1": {"Tla": "NOR"}}']}
        manager = lt.LiveManager(Path('.'), None)
        manager.state.apply('SessionInfo', {'Path': '2026/x/y/'})
        manager.state.laps['1'][3] = {'lap': 3, 'live': True}   # a lap already cut live is kept
        manager.backfill(reader=lambda path, topic: streams.get(topic) if path == '/static/2026/x/y/' else None)
        for _ in range(100):
            if not manager.backfill_status['running']:
                break
            import time; time.sleep(.05)
        self.assertIsNone(manager.backfill_status['error'])
        self.assertEqual(sorted(manager.state.laps['1']), [2, 3])
        self.assertTrue(manager.state.laps['1'][3].get('live'))
        self.assertEqual(manager.backfill_status['laps'], 1)

    def test_backfill_needs_a_session(self):
        with self.assertRaises(ValueError):
            lt.LiveManager(Path('.'), None).backfill(reader=lambda *a: None)

    def test_token_status_never_signs_in(self):
        status = lt.stored_token_status()
        self.assertIn('available', status)



class LiveProjection(unittest.TestCase):
    """Positions are interpolated only between packets at most 0.6 s apart, never held outside the observed interval."""
    def state(self, stamps):
        state = lt.LiveState()
        state.outline_loop = [(0, 0), (10000, 0), (10000, 10000), (0, 10000)]   # decimetres: a 4 km square
        state.line_points = [(0, 0)] * 5
        state.positions['1'] = [(T0 + t, 1 + 1000 * t, 0) for t in stamps]   # 100 m/s along the first side
        return state

    def test_bracketed_samples_follow_the_car_and_long_gaps_use_speed(self):
        stamps = [k * .27 for k in range(12)] + [5 + k * .27 for k in range(12)]   # a 2 s hole after 2.97 s
        state = self.state(stamps)
        times = [T0 + k * .1 for k in range(80)]
        out = state._track_distances('1', times, [360] * len(times))
        self.assertIsNotNone(out)
        distances, _ = out
        for k, d in enumerate(distances):
            self.assertAlmostEqual(d, 100 * k * .1, delta=.5, msg=f'sample {k}')

    def test_samples_after_the_last_packet_are_not_held_at_its_position(self):
        state = self.state([k * .27 for k in range(20)])          # observed to 5.13 s
        times = [T0 + k * .1 for k in range(60)]                  # asks to 5.9 s
        distances, _ = state._track_distances('1', times, [360] * 60)
        self.assertGreater(distances[-1], distances[51] + 70)     # carried on by speed, not frozen at the last packet

    def test_mostly_unbracketed_lap_falls_back_to_integration(self):
        state = self.state([k * 1.0 for k in range(12)])          # 1 Hz positions: nothing is bracketed within 0.6 s
        self.assertIsNone(state._track_distances('1', [T0 + k * .25 + .1 for k in range(40)], [360] * 40))

if __name__ == '__main__':
    unittest.main()
