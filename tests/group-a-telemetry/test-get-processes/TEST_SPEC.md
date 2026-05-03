---
toolName: get_processes
category: group-a-telemetry
risk: low
goal: Verify process listing responds with bounded results and expected fields.
expectedOutput:
  format: json
  requiredFields: [Id, ProcessName]
cases:
  - id: default-query
    description: call with no arguments
    expect: success
  - id: bounded-query
    description: call with limit 5 and sortBy memory
    expect: success
---

This test validates returned process entries and limit behavior.
