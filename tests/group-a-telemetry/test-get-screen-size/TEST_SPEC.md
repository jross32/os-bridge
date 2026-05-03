---
toolName: get_screen_size
category: group-a-telemetry
risk: low
goal: Validate monitor geometry is returned and includes allScreens array.
expectedOutput:
  format: json
  requiredFields: [width, height, allScreens]
cases:
  - id: screen-metrics
    description: call with no args
    expect: success
---

This test validates dimensions and monitor list shape.
