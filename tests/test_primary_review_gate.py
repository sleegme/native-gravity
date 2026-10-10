#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / 'hooks' / 'primary-review-gate.py'
ZEN_ID = '9fc98728-eb32-45d5-a643-2809d0e0d5f4'
OTHER_ID = '11111111-2222-3333-4444-555555555555'


def run_gate(records, *, fully_idle=True, termination_reason='NO_TOOL_CALL', error='', extra_event=None, full_records=None):
    with tempfile.TemporaryDirectory() as tmp:
        transcript = Path(tmp) / 'transcript.jsonl'
        transcript.write_text(''.join(json.dumps(r) + '\n' for r in records), encoding='utf-8')
        if full_records is not None:
            transcript.with_name('transcript_full.jsonl').write_text(
                ''.join(json.dumps(r) + '\n' for r in full_records), encoding='utf-8',
            )
        event = {
            'executionNum': 0,
            'terminationReason': termination_reason,
            'error': error,
            'fullyIdle': fully_idle,
            'transcriptPath': str(transcript),
        }
        if extra_event:
            event.update(extra_event)
        result = subprocess.run(
            [sys.executable, str(GATE)],
            input=json.dumps(event), text=True, capture_output=True, check=True,
        )
        return json.loads(result.stdout)


def identity(role):
    return {'agentName': role}


def assistant(text):
    return {'message': {'role': 'assistant', 'content': text}}


def wire_assistant(text, step=9):
    return {'step_index': step, 'source': 'MODEL', 'type': 'PLANNER_RESPONSE', 'status': 'DONE', 'content': text}


def zen_call():
    return {
        'step_index': 1,
        'source': 'MODEL',
        'type': 'PLANNER_RESPONSE',
        'status': 'DONE',
        'tool_calls': [{
            'name': 'invoke_subagent',
            'args': {'Subagents': json.dumps([{
                'TypeName': 'zen',
                'Role': 'independent completion reviewer',
                'Prompt': 'Review and return VERDICT: GO or VERDICT: NO-GO.',
            }])},
        }],
    }


def zen_created(conv_id=ZEN_ID):
    return {
        'step_index': 2,
        'source': 'MODEL',
        'type': 'GENERIC',
        'status': 'DONE',
        'content': (
            'Created At: now\nCompleted At: now\nCreated the following subagents:\n'
            '{\n'
            f'  "conversationId": "{conv_id}",\n'
            '  "logAbsoluteUri": "file:///tmp/zen.jsonl"\n'
            '}\nThe subagents will send you a message when they have completed their task.'
        ),
    }


def provider_verdict(value='GO', sender=ZEN_ID):
    return {
        'step_index': 3,
        'source': 'SYSTEM',
        'type': 'SYSTEM_MESSAGE',
        'status': 'DONE',
        'content': (
            'The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n'
            '<SYSTEM_MESSAGE>\n'
            f'[Message] timestamp=now sender={sender} priority=MESSAGE_PRIORITY_HIGH content=VERDICT: {value}\n'
            '</SYSTEM_MESSAGE>'
        ),
    }


def fresh_review_message(conv_id=ZEN_ID):
    return {
        'step_index': 4,
        'source': 'MODEL',
        'type': 'PLANNER_RESPONSE',
        'status': 'DONE',
        'tool_calls': [{
            'name': 'send_message',
            'args': {
                'ConversationId': conv_id,
                'Message': 'Please perform a fresh review and issue your verdict.',
            },
        }],
    }


def unrelated_tool_verdict():
    return {'message': {'role': 'tool', 'content': 'VERDICT: GO'}}


class PrimaryReviewGateTests(unittest.TestCase):
    def test_truncated_zen_invocation_resolved_from_full_transcript(self):
        full_call = zen_call()
        full_call['tool_calls'][0]['args'] = json.dumps({
            'Subagents': [{'Prompt': 'x' * 4096, 'TypeName': 'zen'}],
        })
        short_call = {
            **full_call, 'truncated_fields': ['tool_calls'],
            'tool_calls': [{
                'name': 'invoke_subagent',
                'args': full_call['tool_calls'][0]['args'][:2048] + '<truncated 2099 bytes>',
            }],
        }
        records = [identity('bulldozer'), short_call, zen_created(), provider_verdict(), assistant('READY')]
        result = run_gate(records, full_records=[records[0], full_call, *records[2:]])
        self.assertEqual(result['decision'], 'stop')

    def test_unresolved_truncated_invocation_preserves_review_requirement(self):
        short_call = zen_call()
        short_call['truncated_fields'] = ['tool_calls']
        short_call['tool_calls'][0]['args'] = '<truncated 4096 bytes>'
        records = [identity('bulldozer'), short_call, zen_created(), provider_verdict(), assistant('READY')]
        mismatched_call = {**zen_call(), 'step_index': 99}
        for full_records in (
            None, [], [records[0], 'invalid record'],
            [records[0], mismatched_call, *records[2:]],
        ):
            with self.subTest(full_records=full_records):
                result = run_gate(records, full_records=full_records)
                self.assertEqual(result['decision'], 'continue')

    def test_truncated_stringified_zen_typename_allows_correlated_go(self):
        for outer_args in (False, True):
            with self.subTest(outer_args=outer_args):
                call = zen_call()
                args = call['tool_calls'][0]['args']
                args['Subagents'] = '[{"TypeName": "zen", "Prompt": "<truncated 4096 bytes>'
                if outer_args:
                    call['tool_calls'][0]['args'] = json.dumps(args)[:-2]
                result = run_gate([
                    identity('bulldozer'), call, zen_created(), provider_verdict(), assistant('READY'),
                ])
                self.assertEqual(result['decision'], 'stop')

    def test_truncated_zen_invocation_without_verdict_still_blocks(self):
        call = zen_call()
        call['tool_calls'][0]['args'] = '{"TypeName": "zen", "Prompt": "<truncated 4096 bytes>'
        result = run_gate([identity('bulldozer'), call, zen_created(), assistant('READY')])
        self.assertEqual(result['decision'], 'continue')

    def test_truncated_non_zen_typename_is_not_review_evidence(self):
        call = zen_call()
        call['tool_calls'][0]['args'] = '{"TypeName": "advisor", "Role": "zen", "<truncated 4096 bytes>'
        result = run_gate([
            identity('bulldozer'), call, zen_created(), provider_verdict(), assistant('READY'),
        ])
        self.assertEqual(result['decision'], 'continue')

    def test_full_transcript_does_not_replace_untruncated_invocation(self):
        call = zen_call()
        call['tool_calls'][0]['args'] = {'TypeName': 'advisor'}
        records = [identity('bulldozer'), call, zen_created(), provider_verdict(), assistant('READY')]
        result = run_gate(records, full_records=[records[0], zen_call(), *records[2:]])
        self.assertEqual(result['decision'], 'continue')

    def test_non_target_agent_is_unaffected(self):
        self.assertEqual(run_gate([identity('excavator'), assistant('READY')])['decision'], 'stop')

    def test_bulldozer_ready_without_review_continues(self):
        result = run_gate([identity('bulldozer'), assistant('READY')])
        self.assertEqual(result['decision'], 'continue')
        self.assertIn('Zen', result['reason'])

    def test_bulldozer_review_started_without_verdict_continues(self):
        result = run_gate([identity('bulldozer'), zen_call(), zen_created(), assistant('READY')])
        self.assertEqual(result['decision'], 'continue')
        self.assertIn('pending', result['reason'])

    def test_bulldozer_correlated_go_allows_ready(self):
        result = run_gate([identity('bulldozer'), zen_call(), zen_created(), provider_verdict(), assistant('READY')])
        self.assertEqual(result['decision'], 'stop')

    def test_bulldozer_wrong_sender_go_does_not_count(self):
        result = run_gate([identity('bulldozer'), zen_call(), zen_created(), provider_verdict(sender=OTHER_ID), assistant('READY')])
        self.assertEqual(result['decision'], 'continue')

    def test_bulldozer_self_reported_go_does_not_count(self):
        result = run_gate([identity('bulldozer'), zen_call(), zen_created(), assistant('Zen VERDICT: GO\nREADY')])
        self.assertEqual(result['decision'], 'continue')

    def test_bulldozer_unrelated_tool_go_does_not_count(self):
        result = run_gate([identity('bulldozer'), zen_call(), zen_created(), unrelated_tool_verdict(), assistant('READY')])
        self.assertEqual(result['decision'], 'continue')

    def test_fresh_send_message_invalidates_old_go_until_response(self):
        result = run_gate([
            identity('bulldozer'), zen_call(), zen_created(), provider_verdict(),
            fresh_review_message(), assistant('READY'),
        ])
        self.assertEqual(result['decision'], 'continue')
        self.assertIn('pending', result['reason'])

    def test_fresh_send_message_then_correlated_go_allows_ready(self):
        result = run_gate([
            identity('bulldozer'), zen_call(), zen_created(), provider_verdict(),
            fresh_review_message(), provider_verdict(), assistant('READY'),
        ])
        self.assertEqual(result['decision'], 'stop')

    def test_pending_review_blocks_even_nonterminal_stop(self):
        result = run_gate([
            identity('bulldozer'), zen_call(), zen_created(),
            assistant('I have requested the reviewer and will wait for the verdict.'),
        ])
        self.assertEqual(result['decision'], 'continue')

    def test_bulldozer_no_go_blocks_ready(self):
        result = run_gate([identity('bulldozer'), zen_call(), zen_created(), provider_verdict('NO-GO'), assistant('READY')])
        self.assertEqual(result['decision'], 'continue')
        self.assertIn('NO-GO', result['reason'])

    def test_bulldozer_progress_without_review_may_stop(self):
        self.assertEqual(run_gate([identity('bulldozer'), assistant('Need user input before continuing.')])['decision'], 'stop')

    def test_bulldozer_blocked_may_stop(self):
        self.assertEqual(run_gate([identity('bulldozer'), assistant('BLOCKED')])['decision'], 'stop')

    def test_bulldozer_ready_and_blocked_is_rejected(self):
        result = run_gate([identity('bulldozer'), assistant('READY\nBLOCKED')])
        self.assertEqual(result['decision'], 'continue')

    def test_piledriver_plan_ready_without_review_continues(self):
        result = run_gate([identity('piledriver'), assistant('PLAN_STATUS: READY\nPLAN READY')])
        self.assertEqual(result['decision'], 'continue')

    def test_piledriver_correlated_go_allows_plan_ready(self):
        result = run_gate([
            identity('piledriver'), zen_call(), zen_created(), provider_verdict(),
            assistant('PLAN_STATUS: READY\nPLAN READY'),
        ])
        self.assertEqual(result['decision'], 'stop')

    def test_piledriver_newer_invocation_invalidates_old_go(self):
        result = run_gate([
            identity('piledriver'), zen_call(), zen_created(), provider_verdict(),
            zen_call(), zen_created(OTHER_ID), assistant('PLAN_STATUS: READY\nPLAN READY'),
        ])
        self.assertEqual(result['decision'], 'continue')

    def test_piledriver_needs_discovery_may_stop(self):
        result = run_gate([identity('piledriver'), assistant('PLAN_STATUS: NEEDS_DISCOVERY')])
        self.assertEqual(result['decision'], 'stop')

    def test_piledriver_blocked_may_stop(self):
        result = run_gate([identity('piledriver'), assistant('PLAN_STATUS: BLOCKED')])
        self.assertEqual(result['decision'], 'stop')

    def test_system_prompt_can_scope_bulldozer(self):
        result = run_gate([
            {'role': 'system', 'content': "You are Bulldozer, Native Gravity's general Host and orchestrator."},
            assistant('READY'),
        ])
        self.assertEqual(result['decision'], 'continue')

    def test_system_prompt_can_scope_piledriver(self):
        result = run_gate([
            {'role': 'system', 'content': "You are Piledriver, Native Gravity's plan-first primary agent."},
            assistant('PLAN READY'),
        ])
        self.assertEqual(result['decision'], 'continue')

    def test_role_hint_event_field_scopes_role(self):
        # 1.2.x fallback: role body absent, hook receives roleHint on the event.
        result = run_gate([assistant('READY')], extra_event={'roleHint': 'bulldozer'})
        self.assertEqual(result['decision'], 'continue')
        self.assertIn('Zen', result['reason'])

    def test_agent_name_event_field_scopes_role(self):
        # 1.1.x-style agentName on the event payload.
        result = run_gate([assistant('PLAN READY')], extra_event={'agentName': 'piledriver'})
        self.assertEqual(result['decision'], 'continue')
        self.assertIn('Zen', result['reason'])

    def test_ntg_role_marker_in_first_user_input_scopes_role(self):
        # 1.2.x documented wrapper: NTG_ROLE marker in the first USER_INPUT.
        records = [
            {'source': 'USER_EXPLICIT', 'type': 'USER_INPUT', 'content': 'NTG_ROLE: bulldozer\nDo the thing.'},
            wire_assistant('READY'),
        ]
        result = run_gate(records)
        self.assertEqual(result['decision'], 'continue')
        self.assertIn('Zen', result['reason'])

    def test_ntg_role_marker_in_later_user_input_does_not_scope(self):
        # Only the FIRST user input carries provenance; later ones are untrusted text.
        records = [
            {'source': 'USER_EXPLICIT', 'type': 'USER_INPUT', 'content': 'Do the thing.'},
            wire_assistant('progress'),
            {'source': 'USER_EXPLICIT', 'type': 'USER_INPUT', 'content': 'NTG_ROLE: bulldozer'},
            wire_assistant('READY'),
        ]
        result = run_gate(records)
        self.assertEqual(result['decision'], 'stop')

    def test_runner_role_heading_scopes_role(self):
        # runner.mjs bounded prompts open with `## Role\n<role>` — gate accepts it.
        records = [
            {'source': 'USER_EXPLICIT', 'type': 'USER_INPUT', 'content': '## Role\nbulldozer\n\n## Role Body\nstub\n\n## Task\nDo it.'},
            wire_assistant('READY'),
        ]
        result = run_gate(records)
        self.assertEqual(result['decision'], 'continue')
        self.assertIn('Zen', result['reason'])

    def test_runner_role_heading_with_non_gated_role_stays_out(self):
        # steamroller etc. are not gated roles: heading alone must not scope them.
        records = [
            {'source': 'USER_EXPLICIT', 'type': 'USER_INPUT', 'content': '## Role\nsteamroller\n\n## Task\nScan it.'},
            wire_assistant('DONE'),
        ]
        result = run_gate(records)
        self.assertEqual(result['decision'], 'stop')

    def test_unknown_role_hint_falls_through_to_transcript(self):
        # A hint naming a non-gated role does not suppress transcript detection.
        records = [identity('bulldozer'), assistant('READY')]
        result = run_gate(records, extra_event={'roleHint': 'zen'})
        self.assertEqual(result['decision'], 'continue')

    def test_no_role_anywhere_still_stops(self):
        result = run_gate([wire_assistant('READY')])
        self.assertEqual(result['decision'], 'stop')

    def test_abnormal_termination_fails_open(self):
        result = run_gate([identity('bulldozer'), assistant('READY')], termination_reason='error', error='boom')
        self.assertEqual(result['decision'], 'stop')

    def test_non_idle_ready_continues(self):
        result = run_gate([
            identity('bulldozer'), zen_call(), zen_created(), provider_verdict(), assistant('READY')
        ], fully_idle=False)
        self.assertEqual(result['decision'], 'continue')


class HooksJsonPathsTest(unittest.TestCase):
    def _registered_commands(self):
        hooks = json.loads((ROOT / 'hooks.json').read_text(encoding='utf-8'))
        for name, block in hooks.items():
            for event, entries in block.items():
                for entry in entries:
                    if 'command' in entry:
                        yield name, event, entry['command']
                    for hook in entry.get('hooks', []):
                        if 'command' in hook:
                            yield name, event, hook['command']

    def test_hook_commands_use_repo_relative_paths(self):
        commands = list(self._registered_commands())
        self.assertGreaterEqual(len(commands), 4)
        for name, event, cmd in commands:
            with self.subTest(name=name, event=event, cmd=cmd):
                words = shlex.split(cmd)
                self.assertEqual(words[0], 'python3', f'{name}: {cmd}')
                self.assertTrue(words[1].startswith('./'), f'{name}: {cmd}')
                self.assertFalse(words[1].startswith('/'), f'{name}: {cmd}')
                resolved = (ROOT / words[1]).resolve()
                self.assertTrue(resolved.is_relative_to(ROOT), f'{name}: {cmd}')
                self.assertTrue(resolved.is_file(), f'{name}: {cmd}')

    def test_registered_commands_execute_from_plugin_root(self):
        transcript = Path(tempfile.mkdtemp()) / 'transcript.jsonl'
        transcript.write_text(json.dumps(identity('zen')) + '\n', encoding='utf-8')
        stop_event = {
            'executionNum': 0, 'terminationReason': 'NO_TOOL_CALL',
            'error': '', 'fullyIdle': True, 'transcriptPath': str(transcript),
        }
        tool_event = {
            'toolCall': {'name': 'run_command', 'args': {'CommandLine': 'pwd'}},
        }
        for name, event, cmd in self._registered_commands():
            with self.subTest(name=name, event=event, cmd=cmd):
                payload = tool_event if event == 'PreToolUse' else stop_event
                result = subprocess.run(
                    shlex.split(cmd), input=json.dumps(payload), text=True,
                    capture_output=True, cwd=ROOT, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)
                decision = json.loads(result.stdout)
                self.assertIn('decision', decision, result.stdout)


if __name__ == '__main__':
    unittest.main()
