Parse the JSON. The key fields are:
  - `context`: Project background (constraints for you - do NOT include in output)
  - `rules`: Artifact-specific rules (constraints for you - do NOT include in output)
  - `template`: The structure to use for your output file
  - `instruction`: Schema-specific guidance
  - `resolvedOutputPath`: Resolved path or pattern to write the artifact
  - `dependencies`: Completed artifacts to read for context
Create the artifact file:
  - Read any completed dependency files for context
  - Use `template` as the structure - fill in its sections
  - Apply `context` and `rules` as constraints when writing - but do NOT copy them into the file
  - Write to the `resolvedOutputPath` specified in instructions. If it is a glob pattern, choose the concrete file path using the schema instruction and the change's context
"{json}"