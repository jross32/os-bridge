'use strict';

const { assert } = require('../lib/assertions');

module.exports = {
  async run({ client }) {
    const notes = [];

    // 1) Happy path: two simple read-only steps succeed.
    const happy = await client.callTool('workflow_runbook_execute', {
      steps: [
        { tool: 'get_system_info' },
        { tool: 'get_processes', arguments: { limit: 3, sortBy: 'memory' } },
      ],
      stopOnFail: true,
    }, 60000);

    assert(happy.ok, `workflow_runbook_execute happy path failed: ${happy.error}`);
    assert(happy.json && happy.json.summary, 'Expected summary in workflow response');
    assert(happy.json.summary.totalSteps === 2, 'Expected totalSteps=2');
    assert(happy.json.summary.succeeded === 2, 'Expected 2 successful steps');
    assert(happy.json.summary.failed === 0, 'Expected 0 failed steps');
    assert(happy.json.completedAllSteps === true, 'Expected completedAllSteps=true');
    notes.push('workflow happy path passed');

    // 2) Continue-on-error: fail unknown tool and continue.
    const cont = await client.callTool('workflow_runbook_execute', {
      steps: [
        { tool: 'tool_that_does_not_exist', continueOnError: true },
        { tool: 'get_system_info' },
      ],
      stopOnFail: true,
    }, 60000);

    assert(cont.ok, `workflow continueOnError path failed: ${cont.error}`);
    assert(cont.json.summary.totalSteps === 2, 'continueOnError run should have 2 total steps');
    assert(cont.json.summary.failed === 1, 'continueOnError run should have exactly 1 failed step');
    assert(cont.json.summary.succeeded === 1, 'continueOnError run should have exactly 1 successful step');
    assert(cont.json.aborted === false, 'continueOnError run should not abort');
    notes.push('workflow continueOnError path passed');

    // 3) Stop-on-fail: fail first step and abort.
    const abortRun = await client.callTool('workflow_runbook_execute', {
      steps: [
        { tool: 'tool_that_does_not_exist' },
        { tool: 'get_system_info' },
      ],
      stopOnFail: true,
    }, 60000);

    assert(abortRun.ok, `workflow stopOnFail path failed: ${abortRun.error}`);
    assert(abortRun.json.aborted === true, 'stopOnFail run should abort');
    assert(abortRun.json.summary.executedSteps === 1, 'stopOnFail run should execute only first step');
    notes.push('workflow stopOnFail path passed');

    // 4) Guard recursion.
    const recurse = await client.callTool('workflow_runbook_execute', {
      steps: [
        {
          tool: 'workflow_runbook_execute',
          arguments: { steps: [{ tool: 'get_system_info' }] },
        },
      ],
      stopOnFail: false,
    }, 60000);

    assert(recurse.ok, `workflow recursion guard run failed unexpectedly: ${recurse.error}`);
    assert(recurse.json.summary.failed === 1, 'recursion guard should mark one failed step');
    assert(recurse.json.steps[0].error && recurse.json.steps[0].error.code, 'recursion guard should include structured step error');
    notes.push('workflow recursion guard passed');

    // 5) Watch mode should pause before a high-risk step.
    const setWatch = await client.callTool('set_execution_profile', {
      mode: 'watch',
      autoApproveThrough: 'medium',
    });
    assert(setWatch.ok, `Expected watch execution profile setup success: ${setWatch.error}`);

    const gated = await client.callTool('workflow_runbook_execute', {
      steps: [
        { tool: 'get_system_info', risk: 'high' },
      ],
      stopOnFail: true,
    }, 60000);

    assert(gated.ok, `watch-mode gated workflow failed unexpectedly: ${gated.error}`);
    assert(gated.json.pausedForApproval === true, 'watch-mode run should pause for approval');
    assert(gated.json.summary.executedSteps === 0, 'watch-mode gated run should not execute blocked step');
    assert(gated.json.summary.waitingApproval === 1, 'watch-mode gated run should report one waiting approval step');
    assert(gated.json.approvalRequest && gated.json.approvalRequest.step === 1, 'watch-mode gated run should return approval request metadata');
    notes.push('workflow watch-mode gating passed');

    // 6) Watch mode override should allow the same high-risk-tagged step to proceed.
    const approved = await client.callTool('workflow_runbook_execute', {
      steps: [
        { tool: 'get_system_info', risk: 'high' },
      ],
      autoApproveThrough: 'high',
      stopOnFail: true,
    }, 60000);

    assert(approved.ok, `watch-mode override workflow failed unexpectedly: ${approved.error}`);
    assert(approved.json.pausedForApproval === false, 'watch-mode override should not pause');
    assert(approved.json.summary.succeeded === 1, 'watch-mode override should execute the approved step');
    notes.push('workflow watch-mode override passed');

    const setQuiet = await client.callTool('set_execution_profile', { mode: 'quiet' });
    assert(setQuiet.ok, `Expected quiet execution profile reset success: ${setQuiet.error}`);

    // 7) Prompt availability check for continuous workflow prompt.
    const prompts = await client.request('prompts/list', {});
    const promptNames = Array.isArray(prompts.prompts) ? prompts.prompts.map((p) => p.name) : [];
    assert(promptNames.includes('continuous_mcp_improvement'), 'continuous_mcp_improvement prompt should be listed');
    notes.push('continuous_mcp_improvement prompt listed');

    return {
      notes: notes.join('; '),
      details: {
        runbookTool: true,
        promptAdded: true,
      },
    };
  },
};
