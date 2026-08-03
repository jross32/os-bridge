---
toolName: get_security_policy/run_command
category: group-o-security-policy
risk: critical
goal: Verify the default launch-time guarded policy cannot be bypassed by an MCP client.
expectedOutput:
  format: json
  requiredFields: [mode, highRiskTools]
cases:
  - id: guarded-policy-visible
    description: Default policy reports guarded mode.
    expect: success
  - id: shell-blocked-before-execution
    description: run_command is rejected with approval_required before running.
    expect: error
---

This regression test starts a separate default-policy server. It never executes the blocked command.
