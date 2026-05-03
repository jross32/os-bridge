---
toolName: get_open_ports
category: group-a-telemetry
risk: low
goal: Verify listening port inventory returns stable row shape.
expectedOutput:
  format: json
  requiredFields: [address, port, pid, process]
cases:
  - id: list-ports
    description: call with no args
    expect: success
---

This test checks row shape only because port count varies by machine.
