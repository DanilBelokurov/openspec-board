Your task is to update the original artifact file based on the provided JSON instructions and additional comments.

You are given:
- The original artifact content: {artifact}
- A JSON object with configuration keys: "{json}"
- Optional additional comments: {comments}

The JSON contains the following fields (all are required unless noted):
  - "context": Project background information – treat this as a constraint for your work, but DO NOT include it in the output file.
  - "rules": Artifact‑specific rules – treat these as constraints, but DO NOT copy them into the output file.
  - "template": The exact structure (headings, sections, placeholders) to use for the final output. You must fill in each section with appropriate content.
  - "instruction": Schema‑specific guidance (e.g., formatting, style, additional notes) – apply this when writing.
  - "resolvedOutputPath": A concrete file path or a glob pattern where the updated file should be written. If a glob is given, you must choose a single concrete path using the rules below.
  - "dependencies": An array of file paths to completed artifacts that you should read for additional context.

=== WORKFLOW (follow in this exact order) ===

1. Parse the JSON. Validate that all required fields are present and have non‑empty values. If any are missing, report an error and abort.

2. Read every file listed in "dependencies". If a file does not exist or cannot be read, skip it and log a warning (do not fail the whole task). Use the content from successfully read files to enrich your understanding of the project.

3. Determine the concrete output path:
   - If "resolvedOutputPath" is a concrete path (not a glob), use it directly.
   - If it contains wildcards (*, ?, [..]), select the most appropriate file based on:
     * The schema instruction (if it gives a naming convention)
     * The current change context (e.g., branch name, timestamp, version)
     * If no clear rule is given, default to the most recent file matching the pattern (by modification time).
   If no file can be resolved, create a new file at a sensible location (e.g., the current working directory) and note this in a log.

4. Build the new content for the artifact:
   - Use the "template" as the skeleton – preserve its headings and structure exactly.
   - For each section in the template, generate content that:
     * Reflects the project's current state (informed by the original artifact, dependencies, and context).
     * Adheres to the constraints given in "context" and "rules" (these are boundaries you must not violate).
     * Incorporates any explicit requirements from "instruction".
   - **Important**: Do NOT copy the "context" or "rules" text verbatim into the output – they are for your internal guidance only.

5. Apply the additional "comments" (if any):
   - Treat comments as supplementary requirements or corrections.
   - If a comment directly contradicts the template or the instructions, **the comment takes precedence** – adjust the content accordingly.
   - If a comment asks for a specific change (e.g., rephrasing, adding an example), implement it.

6. Write the final content to the concrete output path determined in step 3. Overwrite the file completely (do not merge with existing content unless explicitly allowed by the rules).

=== OUTPUT FORMAT ===
- The resulting file must match the original artifact's extension.
- Use clear, professional language consistent with the project's tone.

Proceed with the update now.