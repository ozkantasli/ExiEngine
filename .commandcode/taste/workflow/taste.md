# Workflow

- Research-first: before building something new, surveys existing solutions, trends, and community complaints/feature requests to identify gaps to fill. Confidence: 0.9
- Prefers explicit step-by-step planning before implementation, then executing the plan in stages. Confidence: 0.9
- Wants security aspects researched and kept current as part of the development process, not as an afterthought. Confidence: 0.8
- Prefers using sub-agents (parallel exploration agents) for project discovery and development work, not just single-agent execution. Confidence: 0.95
- Sets an explicit, high quality bar (e.g., "AAA quality") and wants development to continue iteratively, with measurable quality gates (CI, coverage thresholds, lint, typecheck, benchmark regression), until that bar is met rather than stopping at "it works". Confidence: 0.75
ub Actions) running green on a real remote as a completion criterion, not an optional extra. Confidence: 0.9
- Prefers phased, multi-session delivery: long-term goals are broken into sequential plans where each step is independently shippable and verifiable, rather than one big-bang change. Confidence: 0.8
- Prefers keeping CI/tooling on actively supported Node versions and migrating off deprecated ones (explicitly chose moving the CI matrix from Node 20 to Node 22+24 when asked, rather than staying on Node 20). Confidence: 0.6
