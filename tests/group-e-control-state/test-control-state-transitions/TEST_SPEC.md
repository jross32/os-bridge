---
toolName: get_control_state
category: group-e-control-state
risk: medium
goal: Verify pause and emergency-stop state transitions, and reset behavior.
expectedOutput:
  format: json
  requiredFields: [emergencyStopped, userPaused, inputAllowed]
cases:
  - id: baseline-state
    description: normalized state should allow input
    expect: success
  - id: pause-then-resume
    description: pause_control then resume_control should toggle inputAllowed
    expect: success
  - id: emergency-stop-reset
    description: emergency_stop then reset_emergency_stop should toggle emergency flag
    expect: success
---

This validates control-state transitions that gate high-risk tools.
