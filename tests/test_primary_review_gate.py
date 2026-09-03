#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / 'hooks' / 'primary-review-gate.py'
ZEN_ID = '9fc98728-eb32-45d5-a643-2809d0e0d5f4'
OTHER_ID = '11111111-2222-3333-4444-555555555555'


def run_gate(records, *, fully_idle=True, termination_reason='NO_TOOL_CALL', error=''):
    with tempfile.TemporaryDirectory() as tmp:
        transcript = Path(tmp) / 'transcript.jsonl'
        transcript.write_text(''.join(json.dumps(r) + '\n' for r in records), encoding='utf-8')
        event = {
            'executionNum': 0,
            'terminationReason': termination_reason,
            'error': error,
            'fullyIdle': fully_idle,
            'transcriptPath': str(transcript),
        }
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

    def test_abnormal_termination_fails_open(self):
        result = run_gate([identity('bulldozer'), assistant('READY')], termination_reason='error', error='boom')
        self.assertEqual(result['decision'], 'stop')

    def test_non_idle_ready_continues(self):
        result = run_gate([
            identity('bulldozer'), zen_call(), zen_created(), provider_verdict(), assistant('READY')
        ], fully_idle=False)
        self.assertEqual(result['decision'], 'continue')


if __name__ == '__main__':
    unittest.main()
