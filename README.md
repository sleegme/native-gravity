# oh-my-agy

A small Antigravity-native multi-agent harness inspired by the useful parts of OMO, without porting OMO's full agent/runtime stack.

The v0.1 hypothesis is intentionally simple: use Claude Sonnet 4.6 as the coordinator, Gemini Flash for cheap/general work, Gemini Pro for heavy reasoning/implementation, and Claude Opus 4.6 as the expensive final reviewer with Gemini Pro as the fallback reviewer.

This repository is being bootstrapped now. See the next commit for the runnable plugin scaffold, agents, category routing, and smoke-test scripts.
