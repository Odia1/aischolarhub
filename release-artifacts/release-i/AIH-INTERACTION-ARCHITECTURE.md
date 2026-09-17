# AI Scholar Hub Interaction Architecture

## Primary Experience
Persistent interaction mode defining pedagogy, maturity level, interaction style,
and governed runtime routing.

Examples:
- K-12 Socratic Tutor
- Undergraduate Socratic Tutor
- Instructor Assistant
- PhD/Post-Doc Research Synthesizer

Internal compatibility type: MODE.

## Academic Agent
A deliberately invoked specialized workflow layered on a Primary Experience.

Examples:
- Debate & Sparring Partner
- Research Integrity & Contribution Reviewer
- Research Gap Finder
- Literature Review
- Curriculum Coherence
- Evidence of Learning
- Music Studio
- Education & Career Pathways

Internal compatibility type: AGENT.

## Tools & Capabilities
Operations an Experience or Academic Agent may use, such as:
- Web Search
- File Search
- scholarly literature search
- citation lookup
- audio analysis
- code execution

A tool is a capability, not a persona.

## Knowledge Sources
Authorized information available to Experiences and Agents, including:
- personal files
- course/class knowledge
- institutional knowledge
- department/group collections

RAG may remain an internal implementation term; user-facing terminology is
Knowledge Sources.

## Model / Runtime
Infrastructure hidden from ordinary users:
- class-a
- class-b
- sparring
- Gemini
- DeepSeek
- Groq
- Hugging Face
- credentials and routing

## Composition

User
→ Primary Experience
→ AIH Response Standard
→ optional Academic Agent
→ authorized Tools & Knowledge Sources
→ governed Model / Runtime

## Platform Response Standard

Minimum sufficient response, maximum intellectual value.

Responses should be concise, accurate, adaptive, intellectually engaging,
non-repetitive, and low-friction. Interactive educational workflows should
proceed one useful step at a time.

Workflow steps are internal guidance, not mandatory visible output structure.

## Academic Integrity

Academic integrity is a cross-cutting AI Scholar Hub design property rather than
a single warning, tool, or agent.

AIH should:

- distinguish evidence, inference, uncertainty, interpretation, and opinion;
- preserve citation and Knowledge Source provenance;
- never fabricate references, evidence, measurements, or source access;
- make uncertainty and verification limits visible;
- preserve material contradictory evidence;
- support authorship, attribution, and human scholarly judgment;
- use Evidence of Learning when demonstration of understanding is important;
- flag specific integrity concerns without declaring misconduct absent adequate evidence.

For deeper scholarly review, the governed Academic Agent
`RESEARCH_CLAIM_AUDITOR` is presented to users as **Research Integrity &
Contribution Reviewer**. It evaluates accuracy, evidence, methodology,
novelty/contribution, citation integrity, reasoning, overclaiming, and
professor-style revision priorities.

The lightweight **Analyze a Research Paper** Skill remains distinct: the Skill
helps a user understand a paper; the Reviewer Agent critically evaluates it.

