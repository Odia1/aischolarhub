# AI Scholar Hub — User Help Manual

## 1. AIH Support

AIH Support is the authenticated help capability for AI Scholar Hub. It is
available to legitimate AIH users and provides guidance from approved Support
Knowledge.

AIH Support is separate from Academic Agents. It is read-only and cannot
change roles, permissions, institution scope, RAG access, or security policy.

## 2. Getting Started

After signing in:

1. choose the AIH experience appropriate to your work;
2. use ordinary chat for general assistance;
3. use Academic Agents for specialized learning, teaching, or research tasks;
4. use authorized Knowledge Sources when documents or information have been provided for
   your institution, course, class, group, or account;
5. verify important AI-generated answers.

## 3. Account and Login Help

Use the authentication method approved by your institution. This may include
local credentials, Google SSO, or Microsoft SSO depending on institutional
policy.

If access fails, contact your Institution Admin. Never provide passwords,
tokens, API keys, or recovery codes to AIH Support.

## 4. RAG and Course Knowledge

RAG allows AIH to answer using authorized documents. Access may exist at:

- institution level;
- department/course/class/group level;
- instructor-authorized level;
- personal level.

A stored document is not automatically accessible to all users.

## 5. Academic Agents

Academic Agents are specialized AI assistants for learning, teaching,
research, scholarly analysis, or other approved workflows.

Agents remain subject to role, institution, RAG, tool, and security policy.

## 6. Instructor Workflows

Instructors may use AIH for explanation, learning activities, course
materials, authorized class knowledge, scholarly assistance, and other
institution-approved teaching workflows.

AIH supports instructor judgment; it does not replace responsibility for
curriculum, assessment, grading, or academic integrity.

## 7. Institution Administration

Institution Admins operate only within their assigned institution. Typical
responsibilities include users, instructors, groups, academic structure, RAG
scope, and permitted resources.

## 8. Troubleshooting

For a problem:

1. retry the action once;
2. verify that the relevant experience or agent is available;
3. verify your institution/group/RAG authorization;
4. confirm documents completed upload/processing;
5. record the visible error if the problem continues.

## 9. Common Errors

**Authentication required** — sign in again.

**Permission denied** — your role or scope does not authorize the operation.

**Document unavailable** — the document may not be in your authorized Knowledge Source
scope or may still be processing.

**Upload rejected** — the file may be unsupported, malformed, unsafe, or
contain prohibited active content.

**Agent unavailable** — the agent may not be enabled for your role or
institution.

## 10. Escalation

When escalating, provide your institution, role, the function you were using,
the visible error, and a short description of what occurred.

Do not provide passwords, authentication tokens, API keys, or infrastructure
secrets.

## 11. Security and Privacy

AIH Support does not expose source code, credentials, raw internal logs,
deployment topology, hidden diagnostics, unauthorized files, or another
institution's protected information.

Support cannot elevate your role or bypass AIH authorization.

<!-- AIH_RELEASE_I_INTERACTION_MODEL_START -->

## Release I interaction model

AI Scholar Hub separates four concepts so users can choose help without
needing to understand models, providers, or infrastructure.

### Primary Experience

The **Experience** shown in the header is the persistent way AI Scholar Hub
works with you. Examples include the Undergraduate Socratic Tutor,
Instructor Assistant, and Research Synthesizer.

Changing the Primary Experience changes the continuing learning or research
style of the conversation.

### Academic Agents

**Agents** are invoked from the composer for specialized academic work within
the conversation. They are not a second model selector and do not replace the
user's underlying Primary Experience.

Examples include:

- Literature Review;
- Research Gap Finder;
- Evidence of Learning / Oral Defense;
- Debate & Sparring Partner;
- Research Integrity & Contribution Reviewer.

Use an Agent when a particular task needs deeper specialized reasoning or
review.

### Tools

**Tools** are operational capabilities AI Scholar Hub may use, such as web
search, code execution, Skills, memory, connected resources, or creation of
structured outputs. Availability depends on role and platform policy.

### Skills

Skills are compact, reusable academic workflows. Release I includes two
curated Skills:

- **Study a Topic** — creates a focused learning session with explanation,
  examples, checks for understanding, and a concise recap.
- **Analyze a Research Paper** — identifies the research question, methods,
  findings, limitations, and important claims in a scholarly paper.

A Skill is a repeatable workflow; an Academic Agent provides deeper,
specialized expert assistance.

### Knowledge Sources

**Knowledge Sources** are the personal, course, group, or institutional
documents and information that the user is authorized to use.

Knowledge Sources do not grant new access. AI Scholar Hub continues to
enforce institution, role, group, and document authorization.

## Academic integrity

Academic integrity is a system-wide AI Scholar Hub principle.

AIH should:

- distinguish evidence, inference, interpretation, uncertainty, and opinion;
- preserve source provenance and attribution;
- never fabricate citations, evidence, measurements, or source access;
- state when a source or claim cannot be verified;
- preserve material contradictory evidence;
- support human authorship and scholarly judgment;
- identify specific integrity concerns without declaring plagiarism,
  fabrication, falsification, or misconduct without adequate evidence.

### Research Integrity & Contribution Reviewer

The **Research Integrity & Contribution Reviewer** is an Academic Agent for
professor-style scholarly review of papers, articles, proposals, manuscripts,
or research drafts.

It can examine:

1. accuracy and evidentiary support;
2. methodological soundness;
3. novelty and scholarly contribution;
4. citation integrity and attribution;
5. reasoning and logical gaps;
6. overclaiming or unsupported causal conclusions;
7. questions a professor or reviewer should ask; and
8. the highest-priority revisions.

The Reviewer can verify only material it can actually inspect through supplied
or authorized sources. Novelty assessments must be qualified by the literature
search scope. Final scholarly judgment remains with the human researcher,
author, instructor, or reviewer.

## AIH Support

AIH Support is an authenticated, read-only help capability. It may explain
Experiences, Agents, Tools, Skills, Knowledge Sources, common workflows,
permissions, troubleshooting, and escalation.

AIH Support cannot elevate privileges, bypass authorization, inspect
unauthorized documents, expose secrets or internal diagnostics, or modify
security policy.

<!-- AIH_RELEASE_I_INTERACTION_MODEL_END -->
