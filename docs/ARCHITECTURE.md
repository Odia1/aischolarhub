# AI Scholar Hub — Architectural Note
# Author: Priyadarsan Patra, Arizona
# Date: 1st August 2026

**Status:** Implemented and running. This note documents what was originally
proposed, what actually got built, and what's deliberately left open for later.

## 1. Original Idea
Feature	Undergraduate Student Experience	Post-Doc / PhD Student Experience
Default Model	Socratic Tutor (Gemini Flash backend)	Research Synthesizer (Gemini Flash/Pro backend)
Response Format	Hints, step-by-step breakdowns, guiding questions	Literature tables, BibTeX citations, code review
Output Behavior	Refuses to write full essays or raw code answers	Assists in drafting LaTeX papers and methodology critique
Knowledge Base (RAG)	Grounded in Course Syllabi & Textbooks	Grounded in arXiv, IEEE, and specialized literature folders
Rate Limits	30–50 prompts/day (encourages deliberate study)	150+ prompts/day (supports intense research sprints)

To keep students focused on academic growth rather than using the tool for off-topic distractions, implement these specific administrative guardrails:
A. Apply Socratic & Academic System Constraints
Instead of presenting an unrestricted, open-ended chatbot, configure the back-end system prompts (the hidden rules sent with every request) to steer the interaction:
•	For Undergraduates: Hardcode rules that instruct the AI to act exclusively as a tutor:"You are an academic learning assistant for SEEDS. our sole focus is assisting students with university coursework, research, and skill development. If a user asks non-academic or purely entertainment queries, politely redirect them back to their learning goals."
•	For PhDs & Post-Docs: Configure research-oriented presets focused on literature synthesis, methodology review, and code debugging.
•	For Instructors and Admins, add those roles too.
B. Implement Rolling Quotas & Rate Limits
To prevent a small group of users from exhausting our system or running automated scripts, configure the portal's built-in moderation settings:
•	Daily Token Allowance (Sliding Window): In LibreChat (or Open WebUI), grant every student a daily "credit balance" (e.g., equivalent to ~50 messages a day).
•	Auto-Refill: The system automatically resets their balance every 24 hours. If a student uses up their daily quota exploring a complex concept, they simply resume the following day.
•	Cooldown Timers: Set a limit of 10 messages per 10 minutes. This prevents students from rapidly spamming the AI and encourages them to read and reflect on the answers before asking their next question.
C. Propose and Narrative-Frame This to Stakeholders & Donors
When presenting this resource to college leadership, program managers, or donors, frame the portal using these three core governance pillars:
┌─────────────────────────────────────────────────────────────────────────┐
│                      SEEDS ACADEMIC AI HUB                              │
├──────────────────────────┬──────────────────────┬───────────────────────┤
│   1. Controlled Access   │ 2. Guided Learning   │  3. Anonymized Data   │
│   Institutional SSO      │ Socratic Guardrails  │  Auditing & Analytics │
└──────────────────────────┴──────────────────────┴───────────────────────┘


1.	Managed Institutional Access (Not a Public Toy):
o	Access is gated behind official college single sign-on (SSO) or verified institutional email domains (@student.college.edu).
o	The nonprofit retains total administrative control to revoke access, adjust quotas, or update safety policies at any time.
2.	Pedagogical Alignment (Built for Teaching, Not Shortcuts):
o	Public AI tools often act as "answer engines" that output finished essays or completed code assignments.
o	This portal is tuned as a Socratic Study Companion—it guides students through problem-solving steps, explains underlying principles, and tests comprehension rather than completing the work for them.
3.	Privacy, Safety, and Progress Analytics:
o	Enterprise API terms ensure that student data, research ideas, and coursework remain strictly private and are never used to train public commercial AI models.
o	The nonprofit receives aggregated, privacy-compliant usage metrics to see which academic disciplines (e.g., Computer Science, Economics, Writing) generate the highest student engagement.

### 2.1 Host layer: Azure App Service → self-managed VM

When a student types a prompt into our portal, two distinct layers handle the work:
[ Student's Browser ]
         │ (Low network traffic: basic text)
         ▼
[ Azure / Google Cloud Server ]  <── Heavy Lifting #1: Authentication, Database & Logic
         │ (Lightweight API call: JSON request)
         ▼
[ Google Cloud Data Centers ]    <── Heavy Lifting #2: AI Neural Network Computation
  (Gemini Tensor Processing Units)

[Side Note: App Service was the initial default for "host layer (Azure)," implemented
via Docker Compose (App Service's multi-container mode). In practice this
required substantial workarounds that don't exist on a real VM. Moving the stack to our VM allows real bind mounts, real persistent disk,
`depends_on` works normally, no retirement risk. The trade is that
things App Service handled implicitly — TLS, storage redundancy, OS
patching — now need explicit setup (Apache reverse proxy + certbot, a
cron'd backup script, standard OS maintenance).
]

### 2.2 Implementation vehicle: LibreChat, self-hosted directly

The original proposal was framework-agnostic ("Open WebUI or LibreChat").
An initial design used Open WebUI + a LiteLLM proxy in front of Gemini,
specifically because Open WebUI has no native per-group token budgeting
against a raw provider key — LiteLLM's team-scoped budgets and rate
limits were the mechanism that would have supplied that.
The implementation instead standardized on **LibreChat**, self-hosted,
talking to Gemini directly with no intermediary proxy. This works because
LibreChat turned out to have native equivalents for everything LiteLLM was
covering:

**Note on quota mechanism fidelity:** LibreChat's rate limiter only
supports one window per limiter (IP vs. user), so the literal "50/day AND
10/10min" spec was implemented as a hybrid — `MESSAGE_USER_MAX`/`WINDOW`
covers the burst case (10/10min), while the daily cap is enforced via the
balance system's `autoRefillEnabled` (a token-budget refill rather than a
raw message count). This is arguably a better cost control than the
original spec — a message-count cap doesn't stop one very long message
from spending the whole daily allowance — but it's a deliberate
substitution, not a literal implementation of the original sub-idea.

### 2.3 RAG: shared knowledge base via `rag_api` + pgvector, embeddings on Ollama

The shared/deduplicated RAG requirement is implemented via LibreChat's
companion `rag_api` service against a `pgvector`-enabled Postgres instance,
self-hosted on the VM (rather than Azure Database for PostgreSQL from the
original proposal — same role, different host, for the same reasons as
2.1).

**Embeddings currently run on Ollama** (`nomic-embed-text`), hosted on the
same VM, rather than on Gemini's or OpenAI's embedding APIs. This was a
direct cost decision: `rag_api`'s hosted-Gemini-embeddings path had
reliability problems in practice, and standing up an OpenAI key solely for
embeddings wasn't something to add given the project's near-zero-cost
mandate. Ollama gets embeddings working today at literally zero marginal
API cost.

**This is a deliberate placeholder, not a final architectural position.**
Running an embedding model on the same general-purpose VM that also serves
LibreChat, Mongo, Meilisearch, Postgres, and (soon) other websites is a
real resource-contention risk under load — embedding generation is
CPU-bound and will compete with everything else on the box, especially
during bulk document ingestion. When usage or document-upload volume grows
enough to matter, the natural upgrade paths, roughly in order of effort:
For future:
1. **Move Ollama to its own VM** (even a modest one) — removes the
   resource-contention risk without changing the embeddings model or
   pipeline at all.
2. **Switch to a hosted embeddings API** (Gemini's `text-embedding-004`,
   once the `rag_api` reliability issue is re-verified as resolved, or
   OpenAI's) — trades a small per-embedding cost for removing
   self-hosted-model operational burden entirely.
3. **GPU-backed self-hosted inference** — only worth it at a scale where
   embedding volume itself becomes the bottleneck, which is unlikely for a
   1,000-student text-chunk workload.

## 3. Current architecture

```
                         Students (browser)
                                │
                                ▼  HTTPS
                    Apache/Nginx (Our scalable VM)
                    reverse proxy, TLS via certbot
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                     ▼
   aischolarhub.seedsnet.org              admin-ai.seedsnet.org
              │                                     │
              ▼                                     ▼
   ┌─────────────────────────────────────────────────────────┐
   │                 Ubuntu VM (Azure) — Docker Compose      │
   │                                                         │
   │  api (LibreChat)  ◄──────────────►  admin-panel         │
   │       │  │  │                                               │
   │       │  │  └──► mongodb (users, chats, balances)           │
   │       │  └─────► meilisearch (conversation search)          │
   │       └────────► rag_api ──► vectordb (pgvector)            │
   │                      │                                      │
   │                      ▼                                      │
   │              Ollama (nomic-embed-text)                      │
   │              — same VM, see §2.3 for upgrade path       │
   └─────────────────────────────────────────────────────────┘
              │
              ▼  HTTPS API calls (billed)
     Google Gemini 1.5 Flash — chat completions only
```



## 4. Open items

- Re-verify `rag_api`'s native Gemini-embeddings support before assuming
  Ollama is a permanent fixture (see §2.3) — the reliability problem that
  motivated the Ollama switch may be version-specific and worth
  re-testing against a future `rag_api` release.
- `docs/SCALING.md` covers the general vertical-scaling → managed-services
  → Container Apps progression; Compose-on-App-Service's 2027 retirement
  is irrelevant now that hosting moved off App Service, but Azure
  Container Apps remains the natural target if the VM is ever genuinely
  outgrown.
- Admin Panel's actual user/balance-management surface (vs. CLI scripts)
  hasn't been fully explored — current guidance still treats the CLI
  scripts as the primary provisioning path.

In admin dashboard (Workspace → Prompts / Agents in LibreChat), create two distinct custom AI models:
Persona A: The Undergrad "Socratic Tutor"
•	Target Audience: Bachelor’s / diploma students working through core coursework.
•	Goal: Guide understanding, prevent plagiarized submissions, and build critical thinking.
### SYSTEM INSTRUCTION: SOCRATIC ACADEMIC MENTOR
You are an empathetic, highly structured academic tutor for SEEDS university students. our primary objective is to teach concepts, not complete assignments.

OPERATIONAL RULES:
1. NEVER output direct, copy-pasteable solutions to homework problems, essays, or complete code assignments.
2. When presented with a question or problem, respond with:
   a) A brief explanation of the underlying core concept or formula.
   b) A step-by-step breakdown of how to think through the problem.
   c) A guiding follow-up question asking the student to attempt the next logical step.
3. If a student explicitly asks you to "do my homework" or "write my essay," politely decline:
   - Example: "I am designed to help you master this material so you pass our exams. Let's work through this step-by-step together. What is our initial thought on..."
4. Keep tone encouraging, academic, and clear. Use simple analogies where appropriate.


Persona B: The Post-Doc & PhD "Research Synthesizer"
•	Target Audience: Graduate students, doctoral researchers, and faculty.
•	Goal: Accelerate literature reviews, critique methodologies, and refine academic writing.
### SYSTEM INSTRUCTION: ADVANCED RESEARCH COLLABORATOR
You are a senior academic research assistant for advanced scholars and doctoral candidates.

OPERATIONAL RULES:
1. Assume advanced domain knowledge. Skip basic introductory summaries unless explicitly requested.
2. Focus on:
   - Identifying methodological oversights or logical gaps in research frameworks.
   - Formatting citations in standard LaTeX / BibTeX / APA formats.
   - Summarizing complex papers into literature matrices (Method, Sample Size, Key Findings, Limitations).
3. When analyzing literature or code, highlight edge cases, statistical assumptions, and potential counter-arguments.
4. Maintain a formal, peer-review style tone.

Mapping Personas to Student Roles (Access Control)
To prevent an undergraduate from overriding their Socratic Tutor to select an unconstrained model, use Role-Based Access Control (RBAC).
In LibreChat
1.	Open librechat.yaml (or the Admin Panel → Access Control).
2.	Define Role-Scoped Config Overrides:
# Example role mapping
roles:
  undergrad_student:
    models:
      default: "gemini-socratic-tutor"
      allowed: ["gemini-socratic-tutor"]
  phd_researcher:
    models:
      default: "gemini-research-synth"
      allowed: ["gemini-research-synth", "gemini-2.0-flash"]


3. Discouraging "Free Chatbot" Behaviors (UI & Nudges)
If you present students with a blank text box, they will treat it like a search engine or generic chatbot. Change the interface layout to signal that this is an academic workstation:
A. Pre-Set "One-Touch" Academic Buttons
Instead of a blank prompt bar, display prominent clickable action templates on the home screen:
•	🛠️ "Debug My Code" → System automatically appends: "Analyze this code for bugs, explain the error conceptually, but do NOT give me the fixed code line."
•	📖 "Summarize Paper to Literature Matrix" → Prompts user to paste research PDF and extracts Methodology, Data, and Findings.
•	🧪 "Generate Practice Quiz" → Creates 5 multiple-choice questions based on uploaded lecture notes.
B. Display System Guardrail Banners
Add a static banner or welcome message across the top of the interface:
SEEDS Academic Portal Policy: This AI platform is configured as a 24/7 Socratic Learning Mentor. It is tuned to explain concepts and review drafts. Prompts and outputs are stored privately under institutional guidelines and are governed by the university academic integrity policy.
4. Operational Summary: Undergrad vs. PhD Workflow

==================
________________________________________

What Makes Our Project Novel & Research-Worthy
The novelty lies in how you orchestrate these tools into a purpose-built, cost-free, multi-tier academic learning ecosystem. Most universities either give students unrestricted access to generic chatbots (which leads to copy-pasting homework) or block AI entirely.
our vision creates a managed, pedagogically sound alternative.
                           THE NOVEL ARCHITECTURAL GAP

    Generic Consumer AI                         our Philanthropic AI Hub
┌──────────────────────────┐               ┌─────────────────────────────────┐
│ • Unrestricted answers   │               │ • Socratic tutoring mode        │
│ • Per-user subscription  │      VS.      │ • Zero out-of-pocket (Credits)  │
│ • Commercial data usage  │               │ • Institutional SSO & Quotas   │
│ • No academic guardrails │               │ • Multi-tier RAG (UG vs PhD)    │
└──────────────────────────┘               └─────────────────────────────────┘


1. Pedagogical Innovation: Tiered Socratic Personas
Rather than treating AI as a search bar, our framework uses Role-Based Access Control (RBAC) to enforce developmental learning:
•	Undergraduate Tier: Hardcoded to act as a Socratic Tutor. It explicitly refuses to give raw code or finish essays, forcing the student to learn step-by-step.
•	Post-Doc / PhD Tier: Unlocked as a Research Synthesizer to assist with complex literature reviews, LaTeX formatting, and methodology critique.
2. Multi-Cloud Philanthropic Efficiency
You are demonstrating a novel, highly replicable blueprint for resource-constrained education:
•	Hosting the core server on Microsoft Azure Nonprofit Grants ($2,000/year).
•	Driving the AI inference on Google Cloud Paid Tier / Free Allowances using ultra-cheap models like Gemini 1.5/2.0 Flash.
•	Cost Result: Serving 1,000+ students for near $0 out-of-pocket, proving that high-quality academic AI access does not require massive university software budgets.
3. Institutional Governance & Shared RAG Architecture
our design solves the administrative and legal challenges that prevent colleges from adopting AI:
•	Instructor-Managed Course Libraries: Faculty upload syllabi and core textbooks once into a central vector database, allowing auto-deduplication and massive token cost reductions.
•	Data Privacy: Enterprise API terms ensure student data, research papers, and queries are never leaked to commercial training sets.
Opportunities as a Research & Philanthropic Project
Because this framework addresses major gaps in educational technology, it can serve as a foundation for both academic research and non-profit initiatives:
A. Academic & Educational Research Papers
You can track anonymized portal analytics to publish research on AI in higher education:
•	"The Impact of Socratic System Prompting vs. Unrestricted LLM Access on Undergraduate Problem-Solving."
•	"Optimizing Retrieval-Augmented Generation (RAG) and Context Caching for Large-Scale University Course Textbooks."
•	"Cost-Effective Multi-Cloud Architectures for Deploying AI Infrastructure in Developing Higher Education Ecosystems."
