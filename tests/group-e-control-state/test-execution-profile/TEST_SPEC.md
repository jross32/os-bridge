---
toolName: get_execution_profile/set_execution_profile
category: group-e-control-state
risk: medium
goal: Verify explicit quiet vs visible mode profile behavior and default restoration.
expectedOutput:
  format: json
  requiredFields: [mode, announceActions, preActionDelayMs]
cases:
  - id: set-visible
    description: set visible mode and verify values
    expect: success
  - id: set-quiet
    description: set quiet mode and verify announceActions is false
    expect: success
---

This test enforces explicit opt-in visibility behavior.
