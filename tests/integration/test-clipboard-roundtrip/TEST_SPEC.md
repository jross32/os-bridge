---
toolName: write_clipboard/read_clipboard
category: integration
risk: medium
goal: Verify clipboard roundtrip can be used for cross-tool integration checks.
expectedOutput:
  format: json
  requiredFields: [text]
cases:
  - id: roundtrip
    description: write a token then read clipboard and verify exact match
    expect: success
---

This integration test validates state mutation and retrieval consistency.
