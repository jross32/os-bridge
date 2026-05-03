---
toolName: run_command
category: group-d-dangerous
risk: critical
goal: Verify run_command execution and output envelope for controlled safe command.
expectedOutput:
  format: json
  requiredFields: [stdout, stderr, exitCode, timedOut]
cases:
  - id: safe-echo
    description: run a harmless echo command
    expect: success
---

This test runs only with --dangerous.
