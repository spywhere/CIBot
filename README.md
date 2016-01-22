### Configurations
```yaml
config:
  bot_token:
  working_dir:
  extensions:
  - more.js
  - more.js
  additional_configs:
  - more.yaml
  - more.yaml
sequence: <Sequence>
sequence_info: <Sequence Info>
error_code: <Error Type>
knowledge: <Knowledge>
```

### Sequence
```yaml
commands:
output:
working_dir:
parallel: false
  allows: ["pattern", "*"]
  disallows: ["pattern", "*"]
notify_parallel: true
notify_running: true
```

### Sequence Info
```yaml

```

### Error Types
```yaml
seq_not_found:
  answers:
  - Error response
  - Error response
  dictionary:
seq_queue_wait:
  answers:
  - Error response
  - Error response
  dictionary:
seq_parallel_wait:
  answers:
  - Error response
  - Error response
  dictionary:
seq_running:
  answers:
  - Error response
  - Error response
  dictionary:
cmd_not_found:
  answers:
  - Error response
  - Error response
  dictionary:
```

### Knowledge
```yaml
identifier:
  patterns:
    questions:
    - RegEx pattern
    - RegEx pattern
    captures:
    - Capture name
    - Capture name
    answers:
    - Immediate response
    - Immediate response
    queue_answers:
    - Immediate queuing response
    - Immediate queuing response
  supported_sequences:
  - seqid
  - seqid
  response:
  - Sequence response
  - Sequence response
  associate_sequence: sequence id
  sequence_map:
    capture name:
      -
        value: source text
        map: sequence id
      -
        value: source text
        map: sequence id
  dictionary:
```
