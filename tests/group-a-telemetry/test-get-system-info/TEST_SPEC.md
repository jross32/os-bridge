---
toolName: get_system_info
category: group-a-telemetry
risk: low
goal: Verify the tool returns baseline machine telemetry required by other tests.
expectedOutput:
  format: json
  requiredFields: [cpu, memory, disks, hostname, username, os, osVersion]
cases:
  - id: happy-path
    description: call get_system_info with no arguments
    expect: success
---

This test verifies the minimum shape required for telemetry consumption.
