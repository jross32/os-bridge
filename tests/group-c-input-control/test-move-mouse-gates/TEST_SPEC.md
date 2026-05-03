---
toolName: move_mouse
category: group-c-input-control
risk: high
goal: Verify move_mouse is blocked by pause and emergency-stop safety gates.
expectedOutput:
  format: text
  requiredFields: []
cases:
  - id: blocked-while-paused
    description: pause_control then move_mouse should error
    expect: error
  - id: blocked-while-emergency
    description: emergency_stop then move_mouse should error
    expect: error
---

This confirms core safety-gate enforcement.
