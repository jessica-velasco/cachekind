# Engineering process and AI disclosure

Cachekind was developed using an agentic engineering workflow. AI coding agents
were used as engineering collaborators for research, design exploration,
implementation, testing, review, and documentation. A human directed the work,
selected product and safety decisions, reviewed results, and remains responsible
for what is published.

In this project, **agentic engineering** means:

- work starts from an explicit architecture and phased delivery plan;
- claims about Next.js and Redis behavior are turned into executable probes;
- generated changes are inspected, type-checked, tested, and exercised against
  real processes and Redis instances;
- failure behavior, security boundaries, compatibility, and release gates are
  documented rather than inferred from a successful demo;
- uncertain or externally gated work is reported as such instead of being
  presented as complete.

The phrase is a project-specific process description, not an industry
certification or quality guarantee.

AI involvement does not eliminate defects, security risk, maintenance work, or
the need for independent review. Users should evaluate Cachekind through its
source, tests, documented boundaries, and behavior in their own deployment.
